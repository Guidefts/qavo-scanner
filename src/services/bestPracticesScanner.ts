import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';

export class BestPracticesScanner {
  constructor(private supabase: SupabaseClient) {}

  async scan(page: Page, url: string, scanId: string): Promise<any[]> {
    const issues: any[] = [];
    let testId: string | null = null;

    try {
      const { data: test } = await this.supabase
        .from('qa_tests')
        .insert({
          scan_id: scanId,
          name: 'Best Practices Audit',
          category: 'best_practices',
          status: 'running',
          progress: 0,
        })
        .select('id')
        .single();

      if (!test) throw new Error('Failed to create Best Practices test record.');
      testId = test.id;

      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(url, { waitUntil: 'networkidle' });

      if (consoleErrors.length > 0) {
        issues.push(await this.createIssue(testId, scanId, url, 'Console Errors Found', `The page has ${consoleErrors.length} console errors.`, 'medium', 'Check the browser console for details and fix the reported errors.'));
      }

      const score = Math.max(0, 100 - (issues.length * 10));
      await this.supabase
        .from('qa_tests')
        .update({ status: 'completed', score, progress: 100, last_run: new Date().toISOString() })
        .eq('id', testId);

      console.log(`✅ Best Practices: Found ${issues.length} issues (Score: ${score})`);

    } catch (error) {
      console.error('❌ Best Practices scan error:', error);
      if (testId) {
        await this.supabase.from('qa_tests').update({ status: 'failed' }).eq('id', testId);
      }
    }

    return issues;
  }

  private async createIssue(testId: string, scanId: string, url: string, title: string, description: string, severity: string, recommendation: string) {
    const issuePayload = {
      test_id: testId,
      scan_id: scanId,
      title,
      description,
      severity,
      category: 'best_practices',
      location_url: url,
      recommendation,
      status: 'open',
    };
    await this.supabase.from('qa_issues').insert(issuePayload);
    return { severity };
  }
}
