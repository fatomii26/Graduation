// Shapes shared by the server and browser components

export type TicketView = {
  id: string;
  token: string;
  url: string;
  kind: 'graduate' | 'guest';
  label: string;
  holder: string;
  graduateName: string;
  programme: string;
  misis: string;
  ceremony: string;
  when: string;
  doorsOpen: string;
  venue: string;
  zone: string;
  zoneColor: string;
  door: string;
  doorText: string;
  access: 'none' | 'wheelchair' | 'companion';
  needsAssistance: boolean;
  status: 'valid' | 'void';
  qrSvg: string;
};

export type ActionState = { ok?: string; err?: string } | null;
