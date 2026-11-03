// Default email wording. Technical Settings can override subject and wording per template; "Reset to original"
// removes the override. Placeholders: {name} {misis} {tickets} {ceremony} {paid} {team} and the extra ones listed.

export type TemplateKey =
  | 'sign_in_code'
  | 'receipt_number'
  | 'payment_confirmation'
  | 'third_party_payment'
  | 'third_party_receipt'
  | 'extra_ticket_code'
  | 'transfer_decision'
  | 'name_change_decision'
  | 'lost_ticket'
  | 'ticket_share'
  | 'package_reminder'
  | 'staff_welcome'
  | 'staff_password_link';

export const TEMPLATES: Record<TemplateKey, { label: string; subject: string; body: string; extra: string }> = {
  sign_in_code: {
    label: 'Sign-in code',
    extra: '{code} {minutes}',
    subject: 'Your graduation sign-in code: {code}',
    body: 'Dear {name},\n\nYour sign-in code is {code}. It expires in {minutes} minutes and works once.\n\nIf you did not ask for this code, you can ignore this email.\n\n{team}',
  },
  receipt_number: {
    label: 'Receipt number (Finance Office payment)',
    extra: '{receipt} {link}',
    subject: 'Your Finance Office receipt number {receipt}',
    body:
      'Dear {name},\n\nThank you. Finance has recorded your payment of {paid} for {tickets}.\n\nYour receipt number is {receipt}.\n\n' +
      'To choose your guests\' zone and receive your e-tickets, go to {link}, sign in with your MISIS ({misis}) and enter the receipt number. The receipt number works once.\n\n{team}',
  },
  payment_confirmation: {
    label: 'Payment confirmation notice',
    extra: '{link}',
    subject: 'Payment received: your graduation e-tickets are ready',
    body:
      'Dear {name},\n\nWe have received your payment of {paid} for {tickets} ({ceremony}).\n\n' +
      'Your e-tickets are ready in My E-Tickets: {link}\nShare each guest\'s ticket with them from there. E-tickets are not attached to this email.\n\n{team}',
  },
  third_party_payment: {
    label: 'Paid by someone else (to the student)',
    extra: '{payer} {receipt} {link}',
    subject: 'Your graduation tickets have been paid for',
    body:
      'Dear {name},\n\n{payer} has paid {paid} for {tickets} for you.\n\nYour receipt number is {receipt}. Go to {link}, sign in with your MISIS ({misis}), ' +
      'enter the receipt number and choose your guests\' zone and names. Your e-tickets are issued at once.\n\n{team}',
  },
  third_party_receipt: {
    label: 'Paid by someone else (receipt to the payer)',
    extra: '{payer} {ref}',
    subject: 'Receipt: graduation tickets for {name}',
    body:
      'Dear {payer},\n\nThank you. Your payment of {paid} for {tickets} for {name} (MISIS {misis}) has been received. Reference {ref}.\n\n' +
      'The student has been told and will choose the zone and guest names.\n\n{team}',
  },
  extra_ticket_code: {
    label: 'Extra ticket code',
    extra: '{code} {count} {expires} {link}',
    subject: 'Your extra ticket code {code}',
    body:
      'Dear {name},\n\nYour request for extra guest tickets has been approved. Your code {code} is for up to {count} extra guest ticket(s) and is valid until {expires}.\n\n' +
      'Go to {link}, sign in with your MISIS and enter the code to choose the zone, enter names and pay.\n\n{team}',
  },
  transfer_decision: {
    label: 'Transfer decision',
    extra: '{to} {decision} {note}',
    subject: 'Your ticket transfer request has been {decision}',
    body: 'Dear {name},\n\nYour request to transfer {tickets} to MISIS {to} has been {decision}.{note}\n\n{team}',
  },
  name_change_decision: {
    label: 'Name change decision',
    extra: '{decision} {note}',
    subject: 'Your guest name change has been {decision}',
    body: 'Dear {name},\n\nYour request to change the name on {tickets} has been {decision}.{note}\n\nThe ticket in My E-Tickets has a new QR code if the change was approved. Please share the new ticket with your guest.\n\n{team}',
  },
  lost_ticket: {
    label: 'Lost Ticket resend (by staff)',
    extra: '{holder} {door} {link}',
    subject: 'Your graduation e-ticket for {ceremony}',
    body:
      'Dear {holder},\n\nHere is your e-ticket for {ceremony}:\n{link}\n\nOpen the link to show the QR code. {door}\n\n{team}',
  },
  ticket_share: {
    label: 'Ticket share (by the student)',
    extra: '{holder} {door} {link}',
    subject: 'Your graduation e-ticket for {ceremony}',
    body:
      'Dear {holder},\n\n{name} has shared your e-ticket for {ceremony}:\n{link}\n\nOpen the link to show the QR code. {door}\n\n{team}',
  },
  package_reminder: {
    label: 'Package collection reminder',
    extra: '{items}',
    subject: 'Reminder: collect your graduation package',
    body: 'Dear {name},\n\nPlease collect your graduation package before {ceremony}. Still to collect: {items}.\n\n{team}',
  },
  staff_welcome: {
    label: 'Staff welcome',
    extra: '{role} {link}',
    subject: 'You have access to the MDX Dubai graduation system',
    body:
      'Dear {name},\n\nYou have been given access to the Middlesex University Dubai graduation system as {role}.\n\n' +
      'Sign in at {link} with your university Microsoft account. No password is created for you.\n\n{team}',
  },
  staff_password_link: {
    label: 'Staff password link (fallback sign-in)',
    extra: '{link}',
    subject: 'Set your graduation system password',
    body:
      'Dear {name},\n\nUse this one-time link to set your password for the graduation system. It is valid for 24 hours:\n{link}\n\n' +
      'Nobody, including administrators, can see your password.\n\n{team}',
  },
};

export function render(text: string, vars: Record<string, string | number | null | undefined>) {
  const all: Record<string, string | number | null | undefined> = { team: 'MDX Dubai Graduation Team', ...vars };
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in all ? String(all[k] ?? '') : m));
}
