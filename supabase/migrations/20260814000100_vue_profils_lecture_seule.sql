-- =====================================================================
-- La vue des profils publics redevient ce qu'elle prétend être : une lecture
--
-- CE QUI ÉTAIT POSSIBLE, ET QUI A ÉTÉ CONSTATÉ SUR LA PRODUCTION :
--
--   Un visiteur SANS COMPTE pouvait écrire dans la table profiles à travers
--   la vue public_profiles. Vérifié dans une transaction annulée :
--
--     UPDATE public.public_profiles SET avatar_url = '…' WHERE id = …   → abouti
--     UPDATE public.public_profiles SET location   = 'Pwned'            → 9 profils
--     DELETE FROM public.public_profiles WHERE id = …                   → abouti
--
--   Soit : changer la photo et la ville de n'importe quel membre, tous les
--   profils d'un seul ordre, et supprimer un profil.
--
-- POURQUOI. Deux décisions anodines qui, ensemble, ouvrent la porte :
--
--   1. La vue est déclarée security_invoker = off. Elle s'exécute donc avec
--      les droits de son propriétaire et ne voit pas RLS. C'est voulu pour la
--      LECTURE : une projection publique doit montrer le pseudo et l'avatar de
--      tout le monde, alors que profiles n'est lisible que par son titulaire.
--
--   2. La vue ne porte ni agrégat, ni DISTINCT, ni jointure : PostgreSQL la
--      considère donc comme modifiable, et répercute les écritures sur la
--      table. Or Supabase accorde par défaut TOUS les droits à anon et
--      authenticated sur les nouveaux objets de public. Le GRANT SELECT écrit
--      dans la migration d'origine n'a rien restreint : il a ajouté un droit
--      déjà présent, sans retirer les autres.
--
--   La lecture par-dessus RLS était l'intention. L'écriture par-dessus RLS en
--   était la conséquence, et personne ne l'avait demandée.
--
-- CE QUE FAIT CETTE MIGRATION. On retire les droits d'écriture plutôt que de
-- basculer security_invoker : passer la vue en invoker la rendrait vide pour
-- les visiteurs, puisque profiles n'a aucune politique de lecture publique, et
-- casserait l'affichage des vendeurs sur les fiches d'annonce.
-- =====================================================================

REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- Ceinture et bretelles : même si un droit d'écriture revenait par un
-- ALTER DEFAULT PRIVILEGES ou une remise à plat, la règle ci-dessous refuse
-- toute écriture au niveau de la vue elle-même.
CREATE OR REPLACE RULE public_profiles_pas_d_insertion AS
  ON INSERT TO public.public_profiles DO INSTEAD NOTHING;
CREATE OR REPLACE RULE public_profiles_pas_de_modification AS
  ON UPDATE TO public.public_profiles DO INSTEAD NOTHING;
CREATE OR REPLACE RULE public_profiles_pas_de_suppression AS
  ON DELETE TO public.public_profiles DO INSTEAD NOTHING;

COMMENT ON VIEW public.public_profiles IS
  'Projection publique de profiles : pseudo, avatar, ville, date d''inscription. '
  'security_invoker reste désactivé pour que la LECTURE passe par-dessus RLS, ce '
  'qui est le but. L''écriture est retirée deux fois plutôt qu''une : par REVOKE, '
  'et par des règles DO INSTEAD NOTHING. Un visiteur pouvait auparavant modifier '
  'et supprimer les profils à travers cette vue.';

-- ---------------------------------------------------------------------
-- Le même piège ailleurs
--
-- Toute vue future créée dans public héritera des mêmes droits par défaut.
-- La règle à retenir, faute de pouvoir l'imposer : une vue destinée à la
-- lecture publique se termine par REVOKE ALL puis GRANT SELECT.
-- ---------------------------------------------------------------------
DO $$
DECLARE v record; n int := 0;
BEGIN
  FOR v IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
     WHERE nsp.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND c.relname <> 'public_profiles'
       AND EXISTS (
         SELECT 1 FROM information_schema.role_table_grants g
          WHERE g.table_schema = 'public' AND g.table_name = c.relname
            AND g.grantee IN ('anon', 'authenticated')
            AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
  LOOP
    n := n + 1;
    RAISE WARNING 'La vue % accorde des droits d''écriture à anon ou authenticated', v.relname;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'Aucune autre vue exposée en écriture.';
  END IF;
END $$;
