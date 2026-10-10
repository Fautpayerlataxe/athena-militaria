# Modèles des courriels Supabase Auth

Ces courriels (mot de passe oublié, confirmation d'adresse, etc.) ne sont pas
envoyés par nos fonctions mais par Supabase Auth. Ils se règlent dans le
tableau de bord : Authentication > Emails > Templates. Ce dossier en garde la
version de référence : l'objet est en commentaire sur la première ligne de
chaque fichier, le reste est le corps à coller.

Réglages qui vont avec (Authentication > URL Configuration et SMTP Settings) :

- Site URL : https://www.athenamilitaria.fr
- Redirect URLs : https://www.athenamilitaria.fr/** (le lien de réinitialisation
  revient sur /account?recovery=1) ; aucune adresse github.io.
- SMTP personnalisé par Resend (smtp.resend.com, port 465, utilisateur
  « resend », mot de passe = clé Resend), expéditeur
  noreply@athenamilitaria.fr, nom « Athena Militaria ». Sans lui, Supabase
  n'écrit qu'aux membres de l'équipe, deux fois par heure au plus.

Fichiers : reset-password (Reset Password), confirm-sign-up (Confirm signup),
magic-link (Magic Link), change-email-address (Change Email Address),
invite-user (Invite user), reauthentication (Reauthentication),
password-changed (Security notification « Password changed »).
