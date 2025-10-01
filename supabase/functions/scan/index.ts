import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ScanRequest {
  url: string;
  projectId?: string;
  clientId?: string;
  settings?: Record<string, any>;
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const body: ScanRequest = await req.json();
    const { url, projectId, clientId, settings = {} } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: scan, error: scanError } = await supabase
      .from('qa_scans')
      .insert({
        url,
        status: 'queued',
        progress: 0,
        project_id: projectId,
        client_id: clientId,
        settings,
        summary: {
          totalIssues: 0,
          criticalIssues: 0,
          overallScore: 0,
          completedTests: 0,
          totalTests: 1
        },
        created_by: user.id
      })
      .select()
      .single();

    if (scanError) {
      console.error('Database error:', scanError);
      return new Response(
        JSON.stringify({ error: 'Failed to create scan record' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const scanServiceUrl = Deno.env.get('SCAN_SERVICE_URL');

    if (!scanServiceUrl) {
      return new Response(
        JSON.stringify({
          error: 'Scan service not configured',
          message: 'Please deploy the scanning service and set SCAN_SERVICE_URL environment variable. See SCAN_BACKEND_GUIDE.md for instructions.',
          scanId: scan.id
        }),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const webhookUrl = `${supabaseUrl}/functions/v1/scan-webhook`;

    const scanResponse = await fetch(`${scanServiceUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        scanId: scan.id,
        userId: user.id,
        projectId,
        clientId,
        settings,
        webhookUrl
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!scanResponse.ok) {
      const errorText = await scanResponse.text().catch(() => 'Unknown error');
      await supabase
        .from('qa_scans')
        .update({
          status: 'failed',
          summary: { error: 'Failed to start scan service', details: errorText }
        })
        .eq('id', scan.id);

      return new Response(
        JSON.stringify({
          error: 'Failed to start scan',
          details: errorText,
          statusCode: scanResponse.status
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanId: scan.id,
        message: 'Scan started successfully',
        url: scan.url,
        status: scan.status
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
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
