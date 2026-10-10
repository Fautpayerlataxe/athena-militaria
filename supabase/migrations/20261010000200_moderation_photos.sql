-- =====================================================================
-- Modération : les photos d'une annonce supprimée quittent le stockage
--
-- Une annonce supprimée par la modération (signalement, onglet Articles et
-- suppression d'un compte dans admin.js, Mon compte > Modération dans
-- account.js) quittait la base, et les copies WebP de ses photos quittaient
-- /media/ (rafraichir-cache.php). L'original, lui, restait public dans le
-- bucket product-images, et media.php refabrique ces copies à la demande à
-- partir de l'original : une photo retirée pour un insigne réglementé
-- redevenait publique à la première visite de son adresse /media/.
--
-- Le site efface désormais les originaux, une fois la ligne supprimée
-- confirmée par la base. Mais la seule politique de suppression du bucket,
-- « Suppression de ses propres images » (posée depuis le tableau de bord,
-- relevée dans la sauvegarde du 13 août 2026), ne vise que le dossier du
-- membre connecté : la demande d'un administrateur était refusée, sans
-- erreur (Storage répond une liste vide). Cette politique l'autorise.
--
-- Les administrateurs sont reconnus comme dans toutes les politiques du
-- projet (ADD_ADMIN.sql, 20260813000000_stripe_hardening.sql) : par
-- l'adresse de leur jeton, même liste que ADMIN_EMAILS dans admin.js.
-- Les politiques permissives s'additionnent : celle des vendeurs reste
-- inchangée.
--
-- Idempotente : DROP POLICY IF EXISTS puis CREATE POLICY.
-- =====================================================================

DROP POLICY IF EXISTS "Admin can delete any product image" ON storage.objects;
CREATE POLICY "Admin can delete any product image"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com')
  );
