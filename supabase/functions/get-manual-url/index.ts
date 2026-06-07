// supabase/functions/get-manual-url/index.ts
//
// Long-term version supporting Option 1 (recommended data model)
//
// Recommended long-term model (Option 1):
// - Every *physical PDF file* that can be viewed/streamed has its own row in `manuals`
//   with `storage_path` = exact file, e.g. "shared/candela/MGL Service Manual/Sect 1/8501-00-1762_A.pdf".
// - For the *UI grouping entry* (the single bookshelf "book" the user taps):
//     • Set is_folder = true on that row (see the 20250525 migration)
//     • storage_path = the common folder prefix (e.g. "shared/candela/MGL Service Manual")
//       → this is intentional: the existing startsWith(ownedPath + "/") logic then grants every child chapter.
// - Chapter rows themselves still use exact file paths.
// - chapter_metadata (jsonb) + entry_file_path on the folder row power the viewer chapter grid.
// - This Edge Function's prefix matching + service-role signed URLs already fully support the model.
//
// Deploy with:
//   supabase functions deploy get-manual-url --project-ref YOUR_PROJECT_REF

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers that work for WebViews (including origin: null)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { storage_path } = await req.json();

    if (!storage_path) {
      return new Response(
        JSON.stringify({ error: "storage_path is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client using the user's JWT - good for querying user_manuals with RLS
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Client using service role key - needed to generate signed URLs
    // even when the storage bucket has strict RLS policies.
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      console.error("No user from JWT");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the storage_paths of manuals this user owns
    const { data: ownedRows, error: manualsError } = await supabaseUser
      .from("user_manuals")
      .select(`
        manual_id,
        manuals!inner (
          id,
          storage_path
        )
      `)
      .eq("user_id", user.id);

    if (manualsError) {
      console.error("Error querying user_manuals + manuals:", manualsError);
      return new Response(
        JSON.stringify({ error: "Failed to check ownership" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownedPaths: string[] = (ownedRows || [])
      .map((row: any) => row.manuals?.storage_path)
      .filter((p: string | undefined): p is string => !!p);

    console.log(`User ${user.id} owns these manual paths:`, ownedPaths);
    console.log(`Requested storage_path:`, storage_path);

    // Check access: exact match OR the requested file lives inside one of the user's manuals
    const hasAccess = ownedPaths.some((ownedPath) => {
      if (storage_path === ownedPath) {
        console.log("→ Exact match with owned manual");
        return true;
      }
      if (storage_path.startsWith(ownedPath + "/")) {
        console.log(`→ ${storage_path} is inside owned folder ${ownedPath}`);
        return true;
      }
      return false;
    });

    if (!hasAccess) {
      console.warn(`Access denied for user ${user.id} to ${storage_path}`);
      return new Response(
        JSON.stringify({
          error: "Access denied. This file is not part of any manual you currently own.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate signed URL using the service role client (bypasses storage RLS)
    const { data: signed, error: signError } = await supabaseService.storage
      .from("manuals")
      .createSignedUrl(storage_path, 60 * 60);

    if (signError || !signed?.signedUrl) {
      console.error("Failed to create signed URL for", storage_path, {
        message: signError?.message,
        name: signError?.name,
        details: signError,
      });
      return new Response(
        JSON.stringify({ 
          error: "Failed to generate access URL", 
          details: signError?.message || "Object may not exist at this path" 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Access granted. Returning signed URL for", storage_path);

    return new Response(
      JSON.stringify({ url: signed.signedUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error in get-manual-url:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
