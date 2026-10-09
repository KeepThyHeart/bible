/**
 * Renderer side of the notifications module (task 0128): the typed client for the main-process
 * module (`electron/modules/notifications`, channels `module:notifications:*`). Failures arrive as
 * rejections; events (`state-changed`, `open-target`) come through `on`.
 */
import { createModuleClient } from '../../services/moduleClient';
import type { NotificationsApi, NotificationsEvents } from '../../../../electron/modules/notifications/types';

export const notificationsClient = createModuleClient<NotificationsApi, NotificationsEvents>('notifications');
