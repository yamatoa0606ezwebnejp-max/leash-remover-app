// Deletes the caller's own Supabase account. App Store Review Guideline
// 5.1.1(v): once an app supports creating an account in-app (Sign in with
// Apple + Supabase persistence, see src/state/flow-context.tsx), it must
// also support deleting it in-app. `credits`, `consumed_render_requests`
// and `api_usage` all reference auth.users(id) on delete cascade (see
// supabase/schema.sql and migrations 003/004), so removing the auth user is
// enough to remove everything tied to them — nothing else to clean up here.
//
// Unlike revenuecat-webhook, this is deployed WITH the default JWT
// verification (no --no-verify-jwt): the caller is the signed-in user
// themselves, so Supabase's gateway already rejects a request with no/an
// invalid access token before this code runs. It still needs to know *which*
// user that token belongs to, which is what the anon-key client below is
// for — asking Supabase "who does this token belong to" rather than
// re-implementing JWT verification by hand.
//
//   supabase functions deploy delete-account
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// auto-injected by the Supabase Edge Runtime.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Unauthorized', { status: 401 });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // An anonymous session has no account (no name/email, no purchase
  // history) — nothing here for this endpoint to delete. The client should
  // just clear local state directly instead of calling this.
  if (userData.user.is_anonymous) {
    return new Response('No account to delete', { status: 400 });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    console.error('deleteUser failed', deleteError);
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
});
