import { supabase } from './supabase-config';

export interface Ticket {
    id: string;
    creator_id: string;
    subject: string;
    description: string;
    status: 'open' | 'resolved' | 'closed';
    priority: 'low' | 'medium' | 'high';
    property_id?: string;
    sender_name?: string;
    sender_email?: string;
    sender_phone?: string;
    created_at: string;
    updated_at: string;
}

export interface TicketReply {
    id: string;
    ticket_id: string;
    sender_id: string;
    content: string;
    created_at: string;
}

export const ticketService = {
    supabase,
    createTicket: async (ticket: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>): Promise<Ticket> => {
        const { data, error } = await supabase
            .from('tickets')
            .insert(ticket)
            .select()
            .single();

        if (error) throw error;
        return data as Ticket;
    },

    getTickets: async (userId: string): Promise<Ticket[]> => {
        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('creator_id', userId)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data as Ticket[];
    },

    subscribeToTickets: (userId: string, callback: (tickets: Ticket[]) => void) => {
        supabase
            .from('tickets')
            .select('*')
            .eq('creator_id', userId)
            .order('updated_at', { ascending: false })
            .then(({ data, error }) => {
                if (error) {
                    console.warn('[TicketService] Could not fetch tickets:', error.message);
                    return;
                }
                if (data) callback(data as Ticket[]);
            });

        const channel = supabase
            .channel(`customer-tickets-${userId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'tickets',
                filter: `creator_id=eq.${userId}`
            }, async () => {
                const { data } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('creator_id', userId)
                    .order('updated_at', { ascending: false });
                if (data) callback(data as Ticket[]);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    },

    getTicketById: async (id: string): Promise<Ticket> => {
        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data as Ticket;
    },

    addReply: async (reply: Omit<TicketReply, 'id' | 'created_at'>): Promise<TicketReply> => {
        const { data, error } = await supabase
            .from('ticket_replies')
            .insert(reply)
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('tickets')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', reply.ticket_id);

        return data as TicketReply;
    },

    subscribeToReplies: (ticketId: string, callback: (replies: TicketReply[]) => void) => {
        supabase
            .from('ticket_replies')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true })
            .then(({ data }) => {
                if (data) callback(data as TicketReply[]);
            });

        const channel = supabase
            .channel(`ticket-replies-${ticketId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'ticket_replies',
                filter: `ticket_id=eq.${ticketId}`
            }, async () => {
                const { data } = await supabase
                    .from('ticket_replies')
                    .select('*')
                    .eq('ticket_id', ticketId)
                    .order('created_at', { ascending: true });
                if (data) callback(data as TicketReply[]);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    },

    updateStatus: async (ticketId: string, status: Ticket['status']): Promise<void> => {
        const { error } = await supabase
            .from('tickets')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', ticketId);

        if (error) throw error;
    }
};
