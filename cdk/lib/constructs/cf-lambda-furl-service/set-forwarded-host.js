// CloudFront Function to set x-forwarded-host for Next.js Server Actions
// This ensures the correct host header is available to the application

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : '';

  // Set x-forwarded-host header for Next.js to properly handle server actions
  request.headers['x-forwarded-host'] = { value: host };

  return request;
}
