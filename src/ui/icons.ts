// POC only: Wowhead's icon CDN. The production plan is to self-host icons
// pulled from Blizzard's media API (see PLAN.md, legal notes).
export function iconUrl(icon: string, size: 'large' | 'medium' = 'large'): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`
}
