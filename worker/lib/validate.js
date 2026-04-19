export function validateHandle(body) {
  if (!body.handle_name?.trim()) return 'handle_name is required';
  if (!['fb', 'ig'].includes(body.platform)) return 'platform must be fb or ig';
  if (!body.brand_name?.trim()) return 'brand_name is required';
  if (!body.publisher_id || isNaN(parseInt(body.publisher_id))) return 'publisher_id must be a valid integer';
  return null;
}

export function validatePublisher(body) {
  if (!body.name?.trim()) return 'name is required';
  return null;
}
