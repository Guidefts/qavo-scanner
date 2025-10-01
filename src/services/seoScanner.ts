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

      const title = await page.title();
      if (!title) {
        issues.push(await this.createIssue(testId, scanId, url, 'Missing Title Tag', 'The title tag is missing from the page.', 'high', 'Add a unique and descriptive title tag to the page head.'));
      } else if (title.length > 60) {
        issues.push(await this.createIssue(testId, scanId, url, 'Title Tag Too Long', `The title tag is ${title.length} characters long. It should be 60 characters or less.`, 'medium', 'Shorten the title tag to be more concise and impactful.'));
      }

      const metaElements = await page.locator('meta[name="description"]');
      const metaCount = await metaElements.count();
      if (metaCount === 0) {
        issues.push(await this.createIssue(testId, scanId, url, 'Missing Meta Description', 'The meta description is missing.', 'high', 'Add a compelling meta description to improve click-through rates from search results.'));
      } else {
        const metaDescription = await metaElements.first().getAttribute('content');
        if (!metaDescription) {
          issues.push(await this.createIssue(testId, scanId, url, 'Missing Meta Description', 'The meta description is missing.', 'high', 'Add a compelling meta description to improve click-through rates from search results.'));
        } else if (metaDescription.length > 160) {
          issues.push(await this.createIssue(testId, scanId, url, 'Meta Description Too Long', `The meta description is ${metaDescription.length} characters long. It should be 160 characters or less.`, 'medium', 'Shorten the meta description to ensure it is fully visible in search results.'));
        }
      }

      const h1Count = await page.locator('h1').count();
      if (h1Count === 0) {
        issues.push(await this.createIssue(testId, scanId, url, 'Missing H1 Tag', 'The page is missing an H1 tag.', 'high', 'Add a single, descriptive H1 tag to the page to indicate the main topic.'));
      } else if (h1Count > 1) {
        issues.push(await this.createIssue(testId, scanId, url, 'Multiple H1 Tags', `The page has ${h1Count} H1 tags. There should be only one.`, 'medium', 'Consolidate the H1 tags into a single, primary heading.'));
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

  private async createIssue(testId: string, scanId: string, url: string, title: string, description: string, severity: string, recommendation: string) {
    const issuePayload = {
      test_id: testId,
      scan_id: scanId,
      title,
      description,
      severity,
      category: 'seo',
      location_url: url,
      recommendation,
      status: 'open',
    };
    await this.supabase.from('qa_issues').insert(issuePayload);
    return { severity };
  }
}