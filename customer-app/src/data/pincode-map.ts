export const PINCODE_MAP: Record<string, string> = {
    // South Bangalore
    "560076": "Madiwala", // Or BTM Layout Stage 2
    "560068": "BTM Layout",
    "560034": "Koramangala",
    "560095": "Koramangala",
    "560029": "BTM Layout", // Stage 1
    "560102": "HSR Layout",
    "560041": "Jayanagar",
    "560011": "Jayanagar",
    "560078": "JP Nagar",
    "560069": "Jayanagar",
    "560070": "Banashankari",

    // East Bangalore
    "560008": "Indiranagar",
    "560038": "Indiranagar",
    "560017": "Domlur",
    "560037": "Marathahalli",
    "560066": "Whitefield",
    "560048": "Whitefield",
    "560103": "Bellandur",

    // North Bangalore
    "560032": "Hebbal",
    "560024": "Hebbal",
    "560064": "Yelahanka",
    "560045": "Kalyan Nagar",

    // West Bangalore
    "560010": "Rajajinagar",
    "560040": "Vijayanagar",
    "560079": "Basaveshwaranagar",
    "560055": "Malleshwaram",

    // Central
    "560025": "Richmond Town",
    "560001": "MG Road"
};

const LOCALITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
    "Madiwala": { lat: 12.9178, lng: 77.6199 },
    "BTM Layout": { lat: 12.9166, lng: 77.6101 },
    "Koramangala": { lat: 12.9352, lng: 77.6245 },
    "HSR Layout": { lat: 12.9121, lng: 77.6446 },
    "Jayanagar": { lat: 12.9250, lng: 77.5938 },
    "JP Nagar": { lat: 12.9081, lng: 77.5850 },
    "Banashankari": { lat: 12.9183, lng: 77.5738 },
    "Indiranagar": { lat: 12.9784, lng: 77.6408 },
    "Domlur": { lat: 12.9600, lng: 77.6387 },
    "Marathahalli": { lat: 12.9592, lng: 77.6974 },
    "Whitefield": { lat: 12.9698, lng: 77.7499 },
    "Bellandur": { lat: 12.9279, lng: 77.6762 },
    "Hebbal": { lat: 13.0358, lng: 77.5970 },
    "Yelahanka": { lat: 13.1007, lng: 77.5963 },
    "Kalyan Nagar": { lat: 13.0269, lng: 77.6404 },
    "Rajajinagar": { lat: 12.9910, lng: 77.5550 },
    "Vijayanagar": { lat: 12.9719, lng: 77.5318 },
    "Basaveshwaranagar": { lat: 12.9846, lng: 77.5385 },
    "Malleshwaram": { lat: 13.0030, lng: 77.5707 },
    "Richmond Town": { lat: 12.9678, lng: 77.6037 },
    "MG Road": { lat: 12.9740, lng: 77.6098 }
};

export interface PincodeLocation {
    city: string;
    locality: string;
    lat: number;
    lng: number;
}

export const getPincodeLocation = (pincode: string): PincodeLocation | null => {
    const locality = PINCODE_MAP[pincode];
    if (!locality) return null;

    const coords = LOCALITY_COORDINATES[locality];
    if (!coords) return null;

    return {
        city: "Bengaluru",
        locality,
        lat: coords.lat,
        lng: coords.lng
    };
};
