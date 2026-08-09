const SUPABASE_URL = "https://uctaxgfqdoxtcidllyjv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA";
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Trace de mise au point retirée : elle déversait l'objet client complet dans
// la console de chaque visiteur à chaque chargement de page. La clé anon est
// publique par conception et protégée par les politiques RLS, il ne s'agit
// donc pas d'une fuite, mais d'un bruit inutile en production.
