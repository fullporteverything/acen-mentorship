export const PREVIEW_ALT_DISCORD_ID = "1417619259252801546";
export const OWNER_MAIN_DISCORD_ID = "353994234983874570";

/**
 * Main/preview-alt viewers share only the completed lesson IDs used by the UI.
 * Every other Discord member remains isolated.
 */
export function progressViewerIds(
  discordId: string,
  mainDiscordId: string = OWNER_MAIN_DISCORD_ID
): string[] {
  const main = mainDiscordId.trim();
  if (!main) return [discordId];
  if (discordId === main) return [discordId, PREVIEW_ALT_DISCORD_ID];
  if (discordId === PREVIEW_ALT_DISCORD_ID) return [discordId, main];
  return [discordId];
}

export function autoPassedLessonIds(
  discordId: string,
  completedLessonIds: string[],
  allLessonIds: string[],
  mainDiscordId: string = OWNER_MAIN_DISCORD_ID
): string[] {
  return progressViewerIds(discordId, mainDiscordId).length > 1
    ? [...allLessonIds]
    : completedLessonIds;
}
