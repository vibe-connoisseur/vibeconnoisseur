// Public settings the app needs to start sign-in. The anon key is designed
// to be public; the database rules in supabase/setup.sql keep data private.
import { supabaseEnv } from "../lib/supabase.mts";

export default async () => {
  const { url, anonKey } = supabaseEnv();
  return Response.json(
    { accounts: Boolean(url && anonKey), supabaseUrl: url, supabaseAnonKey: anonKey },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
};

export const config = { path: "/api/config" };
