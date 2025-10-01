import { chromium, Browser, Page } from 'playwright';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PerformanceScanner } from './performanceScanner';
import { AccessibilityScanner } from './accessibilityScanner';
// We will add SEO, Security, and BestPractices later.
// import { SEOScanner } from './seoScanner';
// import { SecurityScanner } from './securityScanner';
// import { BestPracticesScanner } from './bestPracticesScanner';

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
  // private seoScanner: SEOScanner;
  // private securityScanner: SecurityScanner;
  // private bestPracticesScanner: BestPracticesScanner;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    this.performanceScanner = new PerformanceScanner(this.supabase);
    this.accessibilityScanner = new AccessibilityScanner(this.supabase);
    // this.seoScanner = new SEOScanner(this.supabase);
    // this.securityScanner = new SecurityScanner(this.supabase);
    // this.bestPracticesScanner = new BestPracticesScanner(this.supabase);
  }

  async initialize() {
    if (this.browser) {
        console.log('✅ Browser already initialized.');
        return;
    }
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
      console.log(`🎯 [${scanId}] Starting scan for: ${url}`);
      await this.updateScanStatus(scanId, 'running', 0);

      if (!this.browser) {
        await this.initialize();
      }

      const context = await this.browser!.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 QavoScanner/1.0'
      });

      const page = await context.newPage();

      console.log(`📍 [${scanId}] Navigating to URL...`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await this.updateScanStatus(scanId, 'running', 10);

      const testsToRun = settings.tests || {
        performance: true,
        accessibility: true,
        // seo: true,
        // security: true,
        // best_practices: true
      };

      const totalTests = Object.values(testsToRun).filter(v => v).length;
      let completedTests = 0;
      const allIssues: any[] = [];

      if (testsToRun.performance) {
        console.log(`⚡ [${scanId}] Running performance scan...`);
        const perfIssues = await this.performanceScanner.scan(page, url, scanId);
        allIssues.push(...perfIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      if (testsToRun.accessibility) {
        console.log(`♿ [${scanId}] Running accessibility scan...`);
        const a11yIssues = await this.accessibilityScanner.scan(page, url, scanId);
        allIssues.push(...a11yIssues);
        completedTests++;
        await this.updateScanStatus(scanId, 'running', 10 + (completedTests / totalTests) * 80);
      }

      // Add other scanners here later

      const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
      const highCount = allIssues.filter(i => i.severity === 'high').length;

      const summary = {
        totalIssues: allIssues.length,
        criticalIssues: criticalCount + highCount,
        overallScore: this.calculateOverallScore(allIssues),
        completedTests: totalTests,
        totalTests: totalTests
      };

      await this.completeScan(scanId, summary);
      await context.close();
      console.log(`✅ [${scanId}] Scan completed. Found ${allIssues.length} issues.`);

    } catch (error) {
      console.error(`❌ [${scanId}] Scan failed:`, error);
      await this.failScan(scanId, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async updateScanStatus(scanId: string, status: string, progress: number): Promise<void> {
    await this.supabase.from('qa_scans').update({ status, progress }).eq('id', scanId);
  }

  private async completeScan(scanId: string, summary: any): Promise<void> {
    await this.supabase.from('qa_scans').update({
      status: 'completed',
      progress: 100,
      summary,
      completed_at: new Date().toISOString()
    }).eq('id', scanId);
  }

  private async failScan(scanId: string, error: string): Promise<void> {
    await this.supabase.from('qa_scans').update({
      status: 'failed',
      summary: { error },
      completed_at: new Date().toISOString()
    }).eq('id', scanId);
  }

  private calculateOverallScore(issues: any[]): number {
    const weights = { critical: 20, high: 10, medium: 5, low: 2 };
    const deduction = issues.reduce((sum, issue) => sum + (weights[issue.severity as keyof typeof weights] || 0), 0);
    return Math.max(0, 100 - deduction);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
