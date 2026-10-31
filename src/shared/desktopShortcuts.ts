import type { MenuAction } from '@shared/ipc';

export function desktopShortcut(event: {key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean}): MenuAction | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return null;
  if (event.key.toLowerCase() === 'o') return 'open-folder';
  if (event.key.toLowerCase() === 'r') return 'run-scan';
  return null;
}
