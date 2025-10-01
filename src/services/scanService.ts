import { chromium, Browser, Page } from 'playwright';
import { AxePuppeteer } from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ScanRequest {
  url: string;
  scanId: string;
  userId: string;
  projectId?: string;
  clientId?: string;
}

interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    html: string;
    target: string[];
    failureSummary: string;
  }>;
}

export class ScanService {
  private browser: Browser | null = null;

  async initialize() {
    // Launch browser once and reuse
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async performScan(request: ScanRequest): Promise<void> {
    const { url, scanId, userId } = request;

    try {
      // Update scan status to 'running'
      await this.updateScanStatus(scanId, 'running', 0);

      // Launch browser
      if (!this.browser) {
        await this.initialize();
      }

      const context = await this.browser!.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      const page = await context.newPage();

      // Navigate to the URL
      console.log(`Navigating to: ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 60000
      });

      await this.updateScanStatus(scanId, 'running', 20);

      // Run accessibility scan
      console.log('Running accessibility scan...');
      const accessibilityResults = await this.runAccessibilityScan(page, url);
      await this.updateScanStatus(scanId, 'running', 40);

      // Process and save violations
      console.log('Processing violations...');
      const issuesCreated = await this.processViolations(
        accessibilityResults,
        scanId,
        page,
        url
      );
      await this.updateScanStatus(scanId, 'running', 80);

      // Create accessibility test record
      await this.createTestRecord(scanId, 'Accessibility Audit', 'accessibility', issuesCreated.length);

      // Calculate summary
      const summary = {
        totalIssues: issuesCreated.length,
        criticalIssues: issuesCreated.filter(i => i.severity === 'critical' || i.severity === 'high').length,
        overallScore: this.calculateScore(issuesCreated),
        completedTests: 1,
        totalTests: 1
      };

      // Update scan as completed
      await this.completeScan(scanId, summary);

      // Cleanup
      await context.close();

      console.log(`Scan ${scanId} completed successfully`);

    } catch (error) {
      console.error(`Scan ${scanId} failed:`, error);
      await this.failScan(scanId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async runAccessibilityScan(page: Page, url: string): Promise<AxeViolation[]> {
    try {
      // Inject axe-core
      await page.addScriptTag({
        path: require.resolve('axe-core/axe.min.js')
      });

      // Run axe scan
      const results = await page.evaluate(async () => {
        // @ts-ignore - axe is injected
        return await axe.run();
      });

      return results.violations;
    } catch (error) {
      console.error('Accessibility scan error:', error);
      return [];
    }
  }

  private async processViolations(
    violations: AxeViolation[],
    scanId: string,
    page: Page,
    url: string
  ): Promise<Array<{ severity: string }>> {
    const issues: Array<{ severity: string }> = [];

    for (const violation of violations) {
      // Map axe impact to our severity levels
      const severity = this.mapImpactToSeverity(violation.impact);

      for (const node of violation.nodes) {
        try {
          // Get the CSS selector
          const selector = node.target[0];

          // Capture screenshot of the element
          let screenshotBase64: string | null = null;
          try {
            const element = await page.locator(selector).first();
            const screenshot = await element.screenshot({ timeout: 5000 });
            screenshotBase64 = screenshot.toString('base64');
          } catch (screenshotError) {
            console.warn(`Could not capture screenshot for ${selector}:`, screenshotError);
          }

          // Create issue in database
          const { data: issue, error } = await supabase
            .from('qa_issues')
            .insert({
              scan_id: scanId,
              title: violation.help,
              description: node.failureSummary || violation.description,
              severity,
              category: 'accessibility',
              element: node.html,
              screenshot: screenshotBase64 ? `data:image/png;base64,${screenshotBase64}` : null,
              location_url: url,
              location_selector: selector,
              recommendation: `Fix: ${violation.help}. See ${violation.helpUrl} for more information.`,
              status: 'open'
            })
            .select()
            .single();

          if (error) {
            console.error('Error saving issue:', error);
            continue;
          }

          issues.push({ severity });

        } catch (nodeError) {
          console.error('Error processing node:', nodeError);
          continue;
        }
      }
    }

    return issues;
  }

  private async createTestRecord(
    scanId: string,
    name: string,
    category: string,
    issuesCount: number
  ): Promise<void> {
    const score = Math.max(0, 100 - (issuesCount * 5)); // Deduct 5 points per issue

    await supabase
      .from('qa_tests')
      .insert({
        scan_id: scanId,
        name,
        category,
        status: 'completed',
        score,
        progress: 100
      });
  }

  private async updateScanStatus(
    scanId: string,
    status: 'queued' | 'running' | 'completed' | 'failed',
    progress: number
  ): Promise<void> {
    await supabase
      .from('qa_scans')
      .update({
        status,
        progress
      })
      .eq('id', scanId);
  }

  private async completeScan(scanId: string, summary: any): Promise<void> {
    await supabase
      .from('qa_scans')
      .update({
        status: 'completed',
        progress: 100,
        summary,
        completed_at: new Date().toISOString()
      })
      .eq('id', scanId);
  }

  private async failScan(scanId: string, errorMessage: string): Promise<void> {
    await supabase
      .from('qa_scans')
      .update({
        status: 'failed',
        summary: {
          error: errorMessage
        },
        completed_at: new Date().toISOString()
      })
      .eq('id', scanId);
  }

  private mapImpactToSeverity(impact: string): 'critical' | 'high' | 'medium' | 'low' {
    const map: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
      critical: 'critical',
      serious: 'high',
      moderate: 'medium',
      minor: 'low'
    };
    return map[impact] || 'medium';
  }

  private calculateScore(issues: Array<{ severity: string }>): number {
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
