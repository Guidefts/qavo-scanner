import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';

export class SEOScanner {
  constructor(private supabase: SupabaseClient) {}

  async scan(page: Page, url: string, scanId: string): Promise<any[]> {
    const issues: any[] = [];
    let testId: string | null = null;

    try {
      const { data: test } = await this.supabase
        .from('qa_tests')
        .insert({
          scan_id: scanId,
          name: 'SEO Audit',
          category: 'seo',
          status: 'running',
          progress: 0,
        })
        .select('id')
        .single();

      if (!test) throw new Error('Failed to create SEO test record.');
      testId = test.id;

      // Check title
      const title = await page.title();
      if (!title) {
        await this.createIssue(testId, scanId, url, 'Missing Title Tag', 'The title tag is missing from the page.', 'high', 'Add a unique and descriptive title tag to the page head.');
        issues.push({ severity: 'high' });
      } else if (title.length > 60) {
        await this.createIssue(testId, scanId, url, 'Title Tag Too Long', `The title tag is ${title.length} characters long. It should be 60 characters or less.`, 'medium', 'Shorten the title tag to be more concise and impactful.');
        issues.push({ severity: 'medium' });
      }

      // Check meta description
      try {
        const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
        if (!metaDescription) {
          await this.createIssue(testId, scanId, url, 'Missing Meta Description', 'The meta description is missing.', 'high', 'Add a compelling meta description to improve click-through rates from search results.');
          issues.push({ severity: 'high' });
        } else if (metaDescription.length > 160) {
          await this.createIssue(testId, scanId, url, 'Meta Description Too Long', `The meta description is ${metaDescription.length} characters long. It should be 160 characters or less.`, 'medium', 'Shorten the meta description to ensure it is fully visible in search results.');
          issues.push({ severity: 'medium' });
        }
      } catch (e) {
        await this.createIssue(testId, scanId, url, 'Missing Meta Description', 'The meta description is missing.', 'high', 'Add a compelling meta description to improve click-through rates from search results.');
        issues.push({ severity: 'high' });
      }

      // Check H1
      const h1Count = await page.locator('h1').count();
      if (h1Count === 0) {
        await this.createIssue(testId, scanId, url, 'Missing H1 Tag', 'The page is missing an H1 tag.', 'high', 'Add a single, descriptive H1 tag to the page to indicate the main topic.');
        issues.push({ severity: 'high' });
      } else if (h1Count > 1) {
        await this.createIssue(testId, scanId, url, 'Multiple H1 Tags', `The page has ${h1Count} H1 tags. There should be only one.`, 'medium', 'Consolidate the H1 tags into a single, primary heading.');
        issues.push({ severity: 'medium' });
      }

      const score = Math.max(0, 100 - (issues.length * 10));
      await this.supabase
        .from('qa_tests')
        .update({ status: 'completed', score, progress: 100, last_run: new Date().toISOString() })
        .eq('id', testId);

      console.log(`✅ SEO: Found ${issues.length} issues (Score: ${score})`);

    } catch (error) {
      console.error('❌ SEO scan error:', error);
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
      category: 'seo',
      location_url: url,
      recommendation,
      status: 'open',
    });
  }
}