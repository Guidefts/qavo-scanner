import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';

export class SecurityScanner {
  constructor(private supabase: SupabaseClient) {}

  async scan(page: Page, url: string, scanId: string): Promise<any[]> {
    const issues: any[] = [];
    let testId: string | null = null;

    try {
      const { data: test } = await this.supabase
        .from('qa_tests')
        .insert({
          scan_id: scanId,
          name: 'Security Audit',
          category: 'security',
          status: 'running',
          progress: 0,
        })
        .select('id')
        .single();

      if (!test) throw new Error('Failed to create Security test record.');
      testId = test.id;

      const response = await page.goto(url);
      const securityHeaders = response?.headers() || {};

      if (!url.startsWith('https' )) {
        await this.createIssue(testId, scanId, url, 'No HTTPS', 'The page is not served over HTTPS.', 'high', 'Enable HTTPS to secure the connection between the server and the user.');
        issues.push({ severity: 'high' });
      }

      if (!securityHeaders['content-security-policy']) {
        await this.createIssue(testId, scanId, url, 'Missing Content-Security-Policy Header', 'The Content-Security-Policy (CSP) header is missing.', 'medium', 'Implement a strict CSP to prevent XSS and other injection attacks.');
        issues.push({ severity: 'medium' });
      }

      if (!securityHeaders['x-frame-options']) {
        await this.createIssue(testId, scanId, url, 'Missing X-Frame-Options Header', 'The X-Frame-Options header is missing.', 'medium', 'Use the X-Frame-Options header to prevent clickjacking attacks.');
        issues.push({ severity: 'medium' });
      }

      const score = Math.max(0, 100 - (issues.length * 10));
      await this.supabase
        .from('qa_tests')
        .update({ status: 'completed', score, progress: 100, last_run: new Date().toISOString() })
        .eq('id', testId);

      console.log(`✅ Security: Found ${issues.length} issues (Score: ${score})`);

    } catch (error) {
      console.error('❌ Security scan error:', error);
      if (testId) {
        await this.supabase.from('qa_tests').update({ status: 'failed' }).eq('id', testId);
      }
    }

    return issues;
  }

  private async createIssue(testId: string, scanId: string, url: string, title: string, description: string, severity: string, recommendation: string): Promise<void> {
    await this.supabase.from('qa_issues').insert({
      test_id: testId,
      scan_id: scanId,
      title,
      description,
      severity,
      category: 'security',
      location_url: url,
      recommendation,
      status: 'open',
    });
  }
}