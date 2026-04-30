const { createSupabaseAdminClient } = require('./supabase-admin-client');

let supabase;

try {
    supabase = createSupabaseAdminClient();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const DEMO_PROPERTIES = [
    {
        title: 'Blue Nest Girls PG',
        description: 'Bright girls PG in BTM Layout with meals, Wi-Fi, and housekeeping.',
        property_type: 'pg',
        address: {
            text: '22, 2nd Stage, BTM Layout, Bengaluru',
            lat: 12.9166,
            lng: 77.6101,
            pincode: '560076'
        },
        locality: 'BTM Layout',
        city: 'Bengaluru',
        state: 'Karnataka',
        monthly_rent: 9500,
        advance_deposit: 12000,
        total_rooms: 12,
        rooms_available: 6,
        status: 'published',
        tags: ['Girls', 'Premium'],
        amenities: {
            wifi: true,
            ac: false,
            laundry: true,
            security: true
        },
        food_available: true,
        images: [
            '/assets/images/properties/hostel-1.avif',
            '/assets/images/properties/room-1.avif'
        ],
        avg_rating: 4.6,
        total_ratings: 28,
        rooms: [
            {
                room_number: 'A-101',
                room_type: 'Double',
                capacity: 2,
                booked_count: 1,
                price: 9500,
                amenities: ['wifi', 'laundry', 'meals'],
                images: [
                    '/assets/images/properties/room-1.avif',
                    '/assets/images/properties/hostel-1.avif'
                ]
            }
        ]
    },
    {
        title: 'Urban Hive Boys Hostel',
        description: 'Affordable boys hostel in HSR Layout near office hubs and transit.',
        property_type: 'hostel',
        address: {
            text: '14, Sector 2, HSR Layout, Bengaluru',
            lat: 12.9121,
            lng: 77.6446,
            pincode: '560102'
        },
        locality: 'HSR Layout',
        city: 'Bengaluru',
        state: 'Karnataka',
        monthly_rent: 7800,
        advance_deposit: 10000,
        total_rooms: 16,
        rooms_available: 8,
        status: 'published',
        tags: ['Boys', 'Hostel'],
        amenities: {
            wifi: true,
            ac: false,
            laundry: true,
            security: true
        },
        food_available: true,
        images: [
            '/assets/images/properties/hostel-2.webp',
            '/assets/images/properties/room-2.avif'
        ],
        avg_rating: 4.2,
        total_ratings: 41,
        rooms: [
            {
                room_number: 'B-204',
                room_type: 'Triple',
                capacity: 3,
                booked_count: 1,
                price: 7800,
                amenities: ['wifi', 'security'],
                images: [
                    '/assets/images/properties/room-2.avif',
                    '/assets/images/properties/hostel-2.webp'
                ]
            }
        ]
    },
    {
        title: 'Cedar Co-living Suites',
        description: 'Premium co-living stay in Koramangala with flexible plans and lounge access.',
        property_type: 'co-living',
        address: {
            text: '7th Block, Koramangala, Bengaluru',
            lat: 12.9352,
            lng: 77.6245,
            pincode: '560095'
        },
        locality: 'Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        monthly_rent: 13500,
        advance_deposit: 18000,
        total_rooms: 10,
        rooms_available: 4,
        status: 'published',
        tags: ['Co-living', 'Luxury', 'offers'],
        amenities: {
            wifi: true,
            ac: true,
            laundry: true,
            security: true
        },
        food_available: false,
        images: [
            '/assets/images/properties/hostel-3.jpg',
            '/assets/images/properties/room-3.avif'
        ],
        auto_offer: {
            title: 'Launch Offer',
            value: 1500,
            type: 'flat',
            subtitle: 'Instant move-in discount',
            code: 'MOVE1500'
        },
        full_payment_discount: {
            active: true,
            type: 'flat',
            amount: 3000,
            minMonths: 3
        },
        avg_rating: 4.8,
        total_ratings: 17,
        rooms: [
            {
                room_number: 'C-302',
                room_type: 'Single',
                capacity: 1,
                booked_count: 0,
                price: 13500,
                amenities: ['wifi', 'ac', 'security'],
                images: [
                    '/assets/images/properties/room-3.avif',
                    '/assets/images/properties/hostel-3.jpg'
                ]
            }
        ]
    }
];

async function ensureOwnerUser() {
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    let ownerUser = users.find(u => u.email === 'test_owner_e2e@example.com');
    if (!ownerUser) {
        const { data, error } = await supabase.auth.admin.createUser({
            email: 'test_owner_e2e@example.com',
            password: 'password123',
            email_confirm: true,
            user_metadata: { role: 'owner' },
            app_metadata: { role: 'owner' }
        });

        if (error) throw error;
        ownerUser = data.user;
        console.log('Created owner user for demo seed.');
    }

    const ownerId = ownerUser.id;

    const { error: accountError } = await supabase.from('accounts').upsert({
        id: ownerId,
        email: 'test_owner_e2e@example.com',
        phone: '9876543210',
        role: 'owner',
        updated_at: new Date().toISOString()
    });
    if (accountError) throw accountError;

    const { error: ownerError } = await supabase.from('owners').upsert({
        id: ownerId,
        name: 'Test Owner',
        email: 'test_owner_e2e@example.com',
        phone: '9876543210',
        verified: true,
        verification_status: 'approved',
        updated_at: new Date().toISOString()
    });
    if (ownerError) throw ownerError;

    return ownerId;
}

async function seedProperties() {
    console.log('Seeding Properties...');

    const ownerId = await ensureOwnerUser();

    for (const property of DEMO_PROPERTIES) {
        const propertyPayload = {
            owner_id: ownerId,
            title: property.title,
            description: property.description,
            property_type: property.property_type,
            address: property.address,
            locality: property.locality,
            city: property.city,
            state: property.state,
            amenities: property.amenities,
            food_available: property.food_available,
            tags: property.tags,
            images: property.images,
            monthly_rent: property.monthly_rent,
            advance_deposit: property.advance_deposit,
            total_rooms: property.total_rooms,
            rooms_available: property.rooms_available,
            status: property.status,
            published_at: new Date().toISOString(),
            auto_offer: property.auto_offer || null,
            full_payment_discount: property.full_payment_discount || null,
            avg_rating: property.avg_rating,
            total_ratings: property.total_ratings,
            updated_at: new Date().toISOString()
        };

        const { data: existingProperty, error: existingError } = await supabase
            .from('properties')
            .select('id')
            .eq('owner_id', ownerId)
            .eq('title', property.title)
            .maybeSingle();

        if (existingError) {
            console.error(`Error checking property ${property.title}:`, existingError);
            continue;
        }

        let propertyId = existingProperty?.id;
        if (propertyId) {
            const { error: updateError } = await supabase
                .from('properties')
                .update(propertyPayload)
                .eq('id', propertyId);
            if (updateError) {
                console.error(`Error updating property ${property.title}:`, updateError);
                continue;
            }
            console.log(`Updated property: ${property.title}`);
        } else {
            const { data: createdProperty, error: createError } = await supabase
                .from('properties')
                .insert(propertyPayload)
                .select('id')
                .single();

            if (createError) {
                console.error(`Error creating property ${property.title}:`, createError);
                continue;
            }

            propertyId = createdProperty.id;
            console.log(`Created property: ${property.title}`);
        }

        for (const room of property.rooms) {
            const roomPayload = {
                property_id: propertyId,
                room_number: room.room_number,
                room_type: room.room_type,
                capacity: room.capacity,
                booked_count: room.booked_count,
                price: room.price,
                amenities: room.amenities,
                images: room.images,
                is_available: room.booked_count < room.capacity
            };

            const { error: roomError } = await supabase
                .from('rooms')
                .upsert(roomPayload, { onConflict: 'property_id,room_number' });

            if (roomError) {
                console.error(`Error upserting room ${room.room_number} for ${property.title}:`, roomError);
                continue;
            }

            console.log(`Seeded room ${room.room_number} for ${property.title}.`);
        }
    }
}

seedProperties();
