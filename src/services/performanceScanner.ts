import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import lighthouse from 'lighthouse';
import { URL } from 'url';

export class PerformanceScanner {
  constructor(private supabase: SupabaseClient) {}

  async scan(page: Page, url: string, scanId: string): Promise<any[]> {
    const issues: any[] = [];
    let testId: string | null = null;

    try {
      const { data: test } = await this.supabase
        .from('qa_tests')
        .insert({
          scan_id: scanId,
          name: 'Performance Analysis',
          category: 'performance',
          status: 'running',
          progress: 0
        })
        .select('id')
        .single();

      if (!test) throw new Error("Failed to create performance test record.");
      testId = test.id;

      const browser = page.context().browser();
      if (!browser) throw new Error("Browser is not available for Lighthouse scan.");
      
      const port = (new URL(browser.wsEndpoint())).port;
      const lighthouseResult = await lighthouse(url, {
        port: parseInt(port),
        output: 'json',
        logLevel: 'info',
        onlyCategories: ['performance'],
      });

      const audits = lighthouseResult.lhr.audits;
      const score = (lighthouseResult.lhr.categories.performance.score || 0) * 100;

      // Example: Check for a specific audit failure
      if (audits['server-response-time']?.score !== 1) {
        const issuePayload = {
          scan_id: scanId,
          test_id: testId,
          title: audits['server-response-time'].title,
          description: audits['server-response-time'].description,
          severity: 'high',
          category: 'performance',
          location_url: url,
          recommendation: 'Improve server response time (TTFB). This often involves optimizing your backend, database queries, or upgrading your hosting.',
          status: 'open'
        };
        await this.supabase.from('qa_issues').insert(issuePayload);
        issues.push({ severity: 'high' });
      }

      if (audits['largest-contentful-paint']?.score !== 1) {
        const issuePayload = {
            scan_id: scanId,
            test_id: testId,
            title: audits['largest-contentful-paint'].title,
            description: `${audits['largest-contentful-paint'].description} Your LCP was ${audits['largest-contentful-paint'].displayValue}.`,
            severity: 'high',
            category: 'performance',
            location_url: url,
            recommendation: 'Optimize the main content element, ensure it loads quickly.',
            status: 'open'
        };
        await this.supabase.from('qa_issues').insert(issuePayload);
        issues.push({ severity: 'high' });
      }

      await this.supabase
        .from('qa_tests')
        .update({ status: 'completed', score, progress: 100, last_run: new Date().toISOString() })
        .eq('id', testId);

      console.log(`  ✓ Performance: Found ${issues.length} issues (Score: ${score.toFixed(0)})`);

    } catch (error) {
      console.error('  ✗ Performance scan error:', error);
      if (testId) {
        await this.supabase.from('qa_tests').update({ status: 'failed' }).eq('id', testId);
      }
    }
    return issues;
  }
}
