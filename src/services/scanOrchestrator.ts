import { chromium, Browser, Page } from 'playwright';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PerformanceScanner } from './performanceScanner';
import { AccessibilityScanner } from './accessibilityScanner';
import { SEOScanner } from './seoScanner';
import { SecurityScanner } from './securityScanner';
import { BestPracticesScanner } from './bestPracticesScanner';

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
  private seoScanner: SEOScanner;
  private securityScanner: SecurityScanner;
  private bestPracticesScanner: BestPracticesScanner;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    this.performanceScanner = new PerformanceScanner(this.supabase);
    this.accessibilityScanner = new AccessibilityScanner(this.supabase);
    this.seoScanner = new SEOScanner(this.supabase);
    this.securityScanner = new SecurityScanner(this.supabase);
    this.bestPracticesScanner = new BestPracticesScanner(this.supabase);
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

      // Determine which tests to run
      const testsToRun = settings.tests || {
        performance: true,
        accessibility: true,
        seo: true,
        security: true,
        best_practices: true
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
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      // Run Accessibility Scan
      if (testsToRun.accessibility) {
        console.log('♿ Running accessibility scan...');
        const a11yIssues = await this.accessibilityScanner.scan(page, url, scanId);
        allIssues.push(...a11yIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      // Run SEO Scan
      if (testsToRun.seo) {
        console.log('🔍 Running SEO scan...');
        const seoIssues = await this.seoScanner.scan(page, url, scanId);
        allIssues.push(...seoIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      // Run Security Scan
      if (testsToRun.security) {
        console.log('🔒 Running security scan...');
        const secIssues = await this.securityScanner.scan(page, url, scanId);
        allIssues.push(...secIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      // Run Best Practices Scan
      if (testsToRun.best_practices) {
        console.log('✨ Running best practices scan...');
        const bpIssues = await this.bestPracticesScanner.scan(page, url, scanId);
        allIssues.push(...bpIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
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

