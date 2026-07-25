import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Rallye Photo',
  description: 'Informations sur le traitement de vos données personnelles dans le cadre de Rallye Photo.',
};

export default function ConfidentialitePage() {
  return (
    <div style={{
      maxWidth: 720,
      margin: '0 auto',
      padding: '40px 24px 80px',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: '#1a1a2e',
      lineHeight: 1.7,
    }}>
      <Link href="/" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: '#8892b0', textDecoration: 'none',
        marginBottom: 32,
      }}>
        ← Retour
      </Link>

      <h1 style={{
        fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em',
        marginBottom: 8, color: '#1a1a2e',
      }}>
        Politique de confidentialité
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 40 }}>
        Dernière mise à jour : juillet 2026
      </p>

      <Section title="1. Responsable du traitement">
        <p>
          Le responsable du traitement des données personnelles collectées via l'application
          Rallye Photo est <strong>Lilian</strong>, développeur et exploitant du service.
        </p>
        <p>Contact : <a href="mailto:contact@rallye-photo.com" style={{ color: '#e91e8c' }}>contact@rallye-photo.com</a></p>
      </Section>

      <Section title="2. Données collectées">
        <p>Dans le cadre de votre participation à un événement Rallye Photo, les données suivantes sont collectées :</p>
        <ul>
          <li><strong>Prénom</strong> — saisi lors de la participation à un événement.</li>
          <li><strong>Identifiant d'appareil</strong> — généré localement dans votre navigateur pour éviter la duplication de compte.</li>
          <li><strong>Photos et vidéos</strong> — prises ou importées par vos soins lors de la soumission à un défi. Ces médias peuvent contenir des visages et constituer des données potentiellement sensibles au sens de l'article 9 du RGPD.</li>
          <li><strong>Données techniques</strong> — adresse IP (pour la limitation du taux de requêtes), logs serveur, horodatages.</li>
        </ul>
        <p>
          <strong>Comptes organisateurs</strong> (panel) : nom, prénom, adresse e-mail, mot de passe haché.
        </p>
      </Section>

      <Section title="3. Base légale du traitement">
        <p>
          Le traitement est fondé sur le <strong>consentement</strong> (art. 6 (1)(a) RGPD).
          En rejoignant un événement et en soumettant des photos, vous consentez au traitement
          de vos données dans les conditions décrites ci-présent. Vous pouvez retirer votre
          consentement à tout moment en demandant la suppression de vos données.
        </p>
        <p>
          Les photos pouvant contenir des visages, elles peuvent relever de la catégorie
          des données biométriques (art. 9 RGPD). Leur traitement est conditionné au
          consentement explicite du participant.
        </p>
      </Section>

      <Section title="4. Finalités du traitement">
        <ul>
          <li>Organisation et animation d'événements photo (défis, vote, classement).</li>
          <li>Affichage des soumissions dans la galerie de l'événement.</li>
          <li>Notification en temps réel des participants via WebSocket.</li>
          <li>Sécurisation du service (limitation des abus, détection de fraude).</li>
        </ul>
      </Section>

      <Section title="5. Durée de conservation">
        <p>
          Les photos et données de participation sont conservées pendant la durée de vie
          de l'événement, déterminée par l'organisateur selon son abonnement :
        </p>
        <ul>
          <li><strong>Gratuit</strong> : 24 heures après la fin de l'événement.</li>
          <li><strong>Starter</strong> : 7 jours après la fin de l'événement.</li>
          <li><strong>Pro</strong> : 30 jours après la fin de l'événement.</li>
        </ul>
        <p>
          À l'issue de ces délais, les photos sont supprimées automatiquement du stockage objet.
          Les logs techniques sont conservés 30 jours.
        </p>
      </Section>

      <Section title="6. Destinataires des données">
        <p>Vos données sont traitées par les sous-traitants suivants :</p>
        <ul>
          <li><strong>IONOS SE</strong> (Allemagne / Union européenne) — hébergement des photos sur serveur de stockage objet S3-compatible.</li>
          <li><strong>Hosterfy</strong> (France) — base de données MariaDB hébergée en France.</li>
        </ul>
        <p>
          Aucune donnée n'est transmise à des tiers à des fins commerciales ou publicitaires.
        </p>
      </Section>

      <Section title="7. Transferts hors UE">
        <p>
          Les données sont hébergées au sein de l'Union européenne (France et Allemagne).
          Aucun transfert vers des pays tiers n'est effectué.
        </p>
      </Section>

      <Section title="8. Vos droits">
        <p>
          Conformément au RGPD, vous disposez des droits suivants sur vos données :
        </p>
        <ul>
          <li><strong>Droit d'accès</strong> (art. 15) — obtenir une copie de vos données.</li>
          <li><strong>Droit de rectification</strong> (art. 16) — corriger des données inexactes.</li>
          <li><strong>Droit à l'effacement</strong> (art. 17) — demander la suppression de vos données.</li>
          <li><strong>Droit à la portabilité</strong> (art. 20) — recevoir vos données dans un format structuré.</li>
          <li><strong>Droit d'opposition</strong> (art. 21) — vous opposer à certains traitements.</li>
          <li><strong>Droit de retrait du consentement</strong> (art. 7) — à tout moment, sans effet rétroactif.</li>
        </ul>
        <p>
          Pour exercer ces droits, contactez-nous à :{' '}
          <a href="mailto:contact@rallye-photo.com" style={{ color: '#e91e8c' }}>
            contact@rallye-photo.com
          </a>.
          Nous répondrons dans un délai d'un mois.
        </p>
        <p>
          Vous avez également le droit de déposer une réclamation auprès de la{' '}
          <strong>CNIL</strong> (Commission Nationale de l'Informatique et des Libertés) :{' '}
          <a
            href="https://www.cnil.fr"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e91e8c' }}
          >
            www.cnil.fr
          </a>.
        </p>
      </Section>

      <Section title="9. Sécurité">
        <p>
          Les données sont protégées par les mesures techniques suivantes :
          chiffrement des credentials S3 en base de données (AES-256-GCM),
          cookies d'authentification HttpOnly et Secure, HTTPS obligatoire,
          limitation du taux de requêtes par IP, analyse antivirus des fichiers uploadés.
        </p>
      </Section>

      <Section title="10. Cookies">
        <p>
          L'application utilise des cookies strictement nécessaires au fonctionnement du service
          (session d'authentification HttpOnly). Aucun cookie publicitaire ou de traçage tiers
          n'est utilisé.
        </p>
      </Section>

      <div style={{
        marginTop: 48,
        paddingTop: 24,
        borderTop: '1px solid #e5e7eb',
        textAlign: 'center',
      }}>
        <Link href="/" style={{ color: '#e91e8c', fontSize: 14, textDecoration: 'none' }}>
          ← Retourner à l'accueil
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 17, fontWeight: 700, color: '#1a1a2e',
        marginBottom: 12, letterSpacing: '-0.01em',
      }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: '#374151', fontSize: 14.5 }}>
        {children}
      </div>
    </section>
  );
}
