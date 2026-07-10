// wa.me needs the number in international format without the leading "+".
export function whatsappLink(listing) {
  const phone = listing.whatsapp_phone.replace(/^\+/, '')
  const message =
    `Hello ${listing.landlord_name}, I found your listing ` +
    `"${listing.title}" in ${listing.area}, ${listing.district} on RentUg. ` +
    'Is it still available?'
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}
