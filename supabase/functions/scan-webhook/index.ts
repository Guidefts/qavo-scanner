import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface WebhookPayload {
  scanId: string;
  status?: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  currentTest?: {
    testId: string;
    name: string;
    category: string;
    status: string;
    progress: number;
    currentStep?: string;
  };
  test?: {
    id: string;
    name: string;
    category: string;
    status: string;
    score?: number;
    duration?: number;
  };
  issue?: {
    testId: string;
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    element?: string;
    screenshot?: string;
    location?: {
      url: string;
      selector?: string;
      line?: number;
    };
    recommendation?: string;
  };
  summary?: {
    totalIssues: number;
    criticalIssues: number;
    overallScore: number;
    completedTests: number;
    totalTests: number;
  };
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: WebhookPayload = await req.json();
    const { scanId, status, progress, currentTest, test, issue, summary, error } = payload;

    if (!scanId) {
      return new Response(
        JSON.stringify({ error: 'scanId is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (status) {
      const updateData: any = { status };

      if (progress !== undefined) {
        updateData.progress = progress;
      }

      if (summary) {
        updateData.summary = summary;
      }

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (error) {
        updateData.summary = { error };
      }

      const { error: scanError } = await supabase
        .from('qa_scans')
        .update(updateData)
        .eq('id', scanId);

      if (scanError) {
        console.error('Error updating scan:', scanError);
      }
    }

    if (currentTest) {
      const { error: testError } = await supabase
        .from('qa_tests')
        .update({
          status: currentTest.status,
          progress: currentTest.progress,
          current_step: currentTest.currentStep
        })
        .eq('id', currentTest.testId);

      if (testError) {
        console.error('Error updating test:', testError);
      }
    }

    if (test) {
      const { error: testError } = await supabase
        .from('qa_tests')
        .update({
          status: test.status,
          score: test.score,
          duration: test.duration,
          last_run: new Date().toISOString()
        })
        .eq('id', test.id);

      if (testError) {
        console.error('Error updating test completion:', testError);
      }
    }

    if (issue) {
      const { error: issueError } = await supabase
        .from('qa_issues')
        .insert({
          test_id: issue.testId,
          title: issue.title,
          description: issue.description,
          severity: issue.severity,
          category: issue.category,
          element: issue.element,
          screenshot: issue.screenshot,
          location_url: issue.location?.url,
          location_selector: issue.location?.selector,
          location_line: issue.location?.line,
          recommendation: issue.recommendation,
          status: 'open'
        });

      if (issueError) {
        console.error('Error creating issue:', issueError);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});