export interface Hotel {
  name: string;
  city: string;
  address: string;
  phone: string;
  url: string;
  driveTimeCeremony: string;
  driveTimeReception: string;
  blockCode: string | null;
  bookByDate: string | null;
}

// Drive times are approximate, one-time estimates (all four hotels cluster
// within a few blocks of each other on/near S. Ware Rd by the McAllen
// Convention Center) — not a live routing lookup. Re-measure if precision
// matters.
export const HOTELS: Hotel[] = [
  {
    name: 'La Quinta Inn & Suites McAllen',
    city: 'McAllen, TX',
    address: '801 S. Ware Rd, McAllen, TX 78501',
    phone: '(956) 682-6765',
    url: 'https://www.wyndhamhotels.com/laquinta/mcallen-texas/la-quinta-mcallen-convention-center/overview?CID=LC:6ysy27krtpcrqev:53221&iata=00093796',
    driveTimeCeremony: '~10 min',
    driveTimeReception: '~25 min',
    blockCode: null,
    bookByDate: null,
  },
  {
    name: 'Cambria Hotel McAllen',
    city: 'McAllen, TX',
    address: '701 South Ware Rd, McAllen, TX 78501',
    phone: '(956) 618-7207',
    url: 'https://www.choicehotels.com/texas/mcallen/cambria-hotels/txg05?mc=llgoxxpx',
    driveTimeCeremony: '~10 min',
    driveTimeReception: '~25 min',
    blockCode: null,
    bookByDate: null,
  },
  {
    name: 'Embassy Suites by Hilton McAllen',
    city: 'McAllen, TX',
    address: '800 Convention Center Blvd, McAllen, TX 78501',
    phone: '(956) 688-8329',
    url: 'https://www.hilton.com/en/hotels/mfecoes-embassy-suites-mcallen-convention-center/?SEO_id=GMB-AMER-ES-MFECOES&y_source=1_MzM1NTMzOS03MTUtbG9jYXRpb24ud2Vic2l0ZQ%3D%3D',
    driveTimeCeremony: '~10 min',
    driveTimeReception: '~25 min',
    blockCode: null,
    bookByDate: null,
  },
  {
    name: 'Home2 Suites by Hilton McAllen',
    city: 'McAllen, TX',
    address: '525 S Ware Rd, McAllen, TX 78501',
    phone: '(956) 391-2964',
    url: 'https://www.hilton.com/en/hotels/mfemahu-home2-suites-mcallen/',
    driveTimeCeremony: '~8 min',
    driveTimeReception: '~23 min',
    blockCode: null,
    bookByDate: null,
  },
];
