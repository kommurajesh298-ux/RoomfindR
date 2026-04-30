import { buildNotificationEventId } from '../../../shared/notification-events';
import { extractEdgeErrorMessage, postProtectedEdgeFunction } from './protected-edge.service';

type NotificationDispatchInput = {
  userId: string;
  title: string;
  body: string;
  type: string;
  route?: string | null;
  bookingId?: string | null;
  audience: 'customer' | 'owner' | 'admin';
  eventParts: Array<string | number | null | undefined>;
  data?: Record<string, unknown>;
};

type NotificationDispatchResponse = {
  success?: boolean;
  notificationId?: string;
  status?: string;
  deduped?: boolean;
  eventId: string;
};

export const notificationDispatchService = {
  async send(input: NotificationDispatchInput): Promise<NotificationDispatchResponse> {
    const eventId = buildNotificationEventId(...input.eventParts);
    const { response, payload } = await postProtectedEdgeFunction<NotificationDispatchResponse>(
      'send-notification',
      {
        user_id: input.userId,
        title: input.title,
        body: input.body,
        type: input.type,
        notification_type: input.type,
        event_id: eventId,
        route: input.route || undefined,
        booking_id: input.bookingId || undefined,
        data: {
          audience: input.audience,
          route: input.route || undefined,
          booking_id: input.bookingId || undefined,
          type: input.type,
          ...input.data,
        },
      },
      { minValidityMs: 60_000 },
    );

    if (!response.ok) {
      throw new Error(extractEdgeErrorMessage(payload, 'Failed to dispatch notification'));
    }

    return {
      ...(payload || {}),
      eventId,
    };
  },
};
