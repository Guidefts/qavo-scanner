import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import AxeBuilder from '@axe-core/playwright';

export class AccessibilityScanner {
    constructor(private supabase: SupabaseClient) {}

    async scan(page: Page, url: string, scanId: string): Promise<any[]> {
        let testId: string | null = null;
        const issues: any[] = [];

        try {
            const { data: test } = await this.supabase
                .from('qa_tests')
                .insert({
                    scan_id: scanId,
                    name: 'Accessibility Audit',
                    category: 'accessibility',
                    status: 'running',
                    progress: 0
                })
                .select('id')
                .single();

            if (!test) throw new Error("Failed to create accessibility test record.");
            testId = test.id;

            const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

            for (const violation of accessibilityScanResults.violations) {
                const severity = this.mapImpact(violation.impact);
                for (const node of violation.nodes) {
                    const issuePayload = {
                        test_id: testId,
                        scan_id: scanId,
                        title: violation.help,
                        description: node.failureSummary || violation.description,
                        severity,
                        category: 'accessibility',
                        element: node.html,
                        location_url: url,
                        location_selector: node.target.join(', '),
                        recommendation: `${violation.help}. Learn more: ${violation.helpUrl}`,
                        status: 'open'
                    };
                    await this.supabase.from('qa_issues').insert(issuePayload);
                    issues.push({ severity });
                }
            }

            const score = Math.max(0, 100 - (issues.length * 5));

            await this.supabase
                .from('qa_tests')
                .update({ status: 'completed', score, progress: 100, last_run: new Date().toISOString() })
                .eq('id', testId);

            console.log(`✅ Accessibility: Found ${issues.length} issues (Score: ${score})`);

        } catch (error) {
            console.error('❌ Accessibility scan error:', error);
            if (testId) {
                await this.supabase.from('qa_tests').update({ status: 'failed' }).eq('id', testId);
            }
        }
        return issues;
    }

    private mapImpact(impact: string | null | undefined): string {
        const mapping: Record<string, string> = {
            critical: 'critical',
            serious: 'high',
            moderate: 'medium',
            minor: 'low'
        };
        return (impact && mapping[impact]) || 'medium';
    }
}
