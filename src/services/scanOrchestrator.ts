import { chromium, Browser, Page } from 'playwright';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PerformanceScanner } from './performanceScanner';
import { AccessibilityScanner } from './accessibilityScanner';

interface ScanRequest {
  url: string;
  scanId: string;
  userId: string;
  projectId?: string;
  clientId?: string;
  settings: {
    tests?: {
      performance?: boolean;
      accessibility?: boolean;
      seo?: boolean;
      security?: boolean;
      best_practices?: boolean;
    };
  };
}

export class ScanOrchestrator {
  private browser: Browser | null = null;
  private supabase: SupabaseClient;
  private performanceScanner: PerformanceScanner;
  private accessibilityScanner: AccessibilityScanner;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    this.performanceScanner = new PerformanceScanner(this.supabase);
    this.accessibilityScanner = new AccessibilityScanner(this.supabase);
  }

  async initialize() {
    console.log('🔧 Initializing browser...');
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('✅ Browser initialized successfully.');
  }

  async performCompleteScan(request: ScanRequest): Promise<void> {
    const { url, scanId, settings } = request;

    try {
      console.log(`🎯 Starting scan for: ${url}`);

      // Update scan status to running
      await this.updateScanStatus(scanId, 'running', 0);

      if (!this.browser) {
        await this.initialize();
      }

      const context = await this.browser!.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (compatible; QavoScanner/1.0)'
      });

      const page = await context.newPage();

      // Navigate to URL
      console.log('📍 Navigating to URL...');
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await this.updateScanStatus(scanId, 'running', 5);

      // Capture screenshots at different viewports
      console.log('📸 Capturing screenshots...');
      const screenshots: { [key: string]: string | null } = { 
        mobile: null, 
        tablet: null, 
        desktop: null 
      };
      
      const viewports = [
        { name: 'mobile', width: 375, height: 667 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'desktop', width: 1440, height: 900 }
      ];

      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(1000); // Wait for layout
        
        const screenshot = await page.screenshot({ type: 'png', fullPage: true });
        const uploadedUrl = await this.uploadScreenshot(screenshot, scanId, viewport.name);
        
        if (uploadedUrl) {
          screenshots[viewport.name] = uploadedUrl;
        }
      }

      // Update scan record with screenshots
      await this.supabase
        .from('qa_scans')
        .update({ screenshots })
        .eq('id', scanId);

      await this.updateScanStatus(scanId, 'running', 20);

      // Determine which tests to run (only performance and accessibility available)
      const testsToRun = settings.tests || {
        performance: true,
        accessibility: true
      };

      const totalTests = Object.values(testsToRun).filter(v => v).length;
      let completedTests = 0;
      const allIssues: any[] = [];

      // Run Performance Scan
      if (testsToRun.performance) {
        console.log('⚡ Running performance scan...');
        const perfIssues = await this.performanceScanner.scan(page, url, scanId);
        allIssues.push(...perfIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 20 + (completedTests / totalTests) * 70);
      }

      // Run Accessibility Scan
      if (testsToRun.accessibility) {
        console.log('♿ Running accessibility scan...');
        const a11yIssues = await this.accessibilityScanner.scan(page, url, scanId);
        allIssues.push(...a11yIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 20 + (completedTests / totalTests) * 70);
      }

      // Calculate summary
      const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
      const highCount = allIssues.filter(i => i.severity === 'high').length;

      const summary = {
        totalIssues: allIssues.length,
        criticalIssues: criticalCount + highCount,
        overallScore: this.calculateOverallScore(allIssues),
        completedTests: totalTests,
        totalTests: totalTests
      };

      // Complete scan
      await this.completeScan(scanId, summary);

      await context.close();

      console.log(`✅ Scan ${scanId} completed - Found ${allIssues.length} issues`);

    } catch (error) {
      console.error(`❌ Scan ${scanId} failed:`, error);
      await this.failScan(scanId, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async uploadScreenshot(
    screenshotBuffer: Buffer, 
    scanId: string, 
    viewport: string
  ): Promise<string | null> {
    try {
      const fileName = `${scanId}/${viewport}.png`;
      
      const { data, error } = await this.supabase.storage
        .from('screenshots')
        .upload(fileName, screenshotBuffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (error) {
        console.error(`Failed to upload ${viewport} screenshot:`, error);
        return null;
      }

      // Get public URL
      const { data: { publicUrl } } = this.supabase.storage
        .from('screenshots')
        .getPublicUrl(fileName);

      return publicUrl;
    } catch (error) {
      console.error(`Error uploading ${viewport} screenshot:`, error);
      return null;
    }
  }

  private async updateScanStatus(
    scanId: string,
    status: string,
    progress: number
  ): Promise<void> {
    await this.supabase
      .from('qa_scans')
      .update({ status, progress })
      .eq('id', scanId);
  }

  private async completeScan(scanId: string, summary: any): Promise<void> {
    await this.supabase
      .from('qa_scans')
      .update({
        status: 'completed',
        progress: 100,
        summary,
        completed_at: new Date().toISOString()
      })
      .eq('id', scanId);
  }

  private async failScan(scanId: string, error: string): Promise<void> {
    await this.supabase
      .from('qa_scans')
      .update({
        status: 'failed',
        summary: { error },
        completed_at: new Date().toISOString()
      })
      .eq('id', scanId);
  }

  private calculateOverallScore(issues: any[]): number {
    const weights = { critical: 20, high: 10, medium: 5, low: 2 };
    const deduction = issues.reduce((sum, issue) => {
      return sum + (weights[issue.severity as keyof typeof weights] || 0);
    }, 0);
    return Math.max(0, 100 - deduction);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
