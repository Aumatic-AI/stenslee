// Upgrades are handled over WhatsApp for now.
const UPGRADE_WHATSAPP_NUMBER = "919849884501";

export function upgradeWhatsAppUrl(studioName?: string | null): string {
  const text = studioName
    ? `Hi, I'd like to upgrade the Stenslee plan for ${studioName}.`
    : "Hi, I'd like to upgrade my Stenslee plan.";
  return `https://wa.me/${UPGRADE_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}
