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
    creator_details?: {
        id: string;
        fullName: string;
        email: string;
        role: string;
    }
}

export interface TicketReply {
    id: string;
    ticket_id: string;
    sender_id: string;
    content: string;
    created_at: string;
}

export const ticketService = {
    getAllTickets: async (): Promise<Ticket[]> => {
        const { data: tickets, error: ticketsError } = await supabase
            .from('tickets')
            .select('*')
            .order('updated_at', { ascending: false });

        if (ticketsError) throw ticketsError;

        // Fetch creator details
        const creatorIds = Array.from(new Set(tickets.map(t => t.creator_id)));
        const { data: accounts, error: accountsError } = await supabase
            .from('accounts')
            .select('*')
            .in('id', creatorIds);

        if (accountsError) throw accountsError;

        const accountsMap = new Map(accounts.map(a => [a.id, a]));

        return tickets.map(t => ({
            ...t,
            creator_details: accountsMap.has(t.creator_id) ? {
                id: t.creator_id,
                fullName: accountsMap.get(t.creator_id).name || accountsMap.get(t.creator_id).full_name || 'Unknown User',
                email: accountsMap.get(t.creator_id).email || 'N/A',
                role: accountsMap.get(t.creator_id).role || 'user'
            } : undefined
        }));
    },

    subscribeToAllTickets: (callback: (tickets: Ticket[]) => void) => {
        ticketService.getAllTickets().then(callback);

        const channel = supabase
            .channel('admin-all-tickets')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'tickets'
            }, async () => {
                const tickets = await ticketService.getAllTickets();
                callback(tickets);
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

    updateTicketStatus: async (id: string, status: Ticket['status']): Promise<void> => {
        const { error } = await supabase
            .from('tickets')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;
    }
};
