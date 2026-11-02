import { graphqlRequest } from './shopify.js';

const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        resourceUrl
        url
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Upload image bytes to Shopify's staged upload storage.
 * @returns {Promise<string>} resourceUrl to pass as `originalSource` to fileCreate / productCreateMedia
 */
export async function stageImageUpload(domain, token, { buffer, filename, contentType }) {
  const stagedData = await graphqlRequest(domain, token, STAGED_UPLOADS_CREATE, {
    input: [{
      resource: 'IMAGE',
      filename,
      mimeType: contentType,
      httpMethod: 'POST',
      fileSize: String(buffer.length),
    }],
  });

  const target = stagedData.stagedUploadsCreate.stagedTargets?.[0];
  const stagedErrors = stagedData.stagedUploadsCreate.userErrors;
  if (stagedErrors?.length > 0) {
    throw new Error(`Staged upload error: ${stagedErrors.map(e => e.message).join(', ')}`);
  }
  if (!target) {
    throw new Error('No staged upload target returned');
  }

  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  form.append('file', new Blob([buffer], { type: contentType }), filename);

  const uploadRes = await fetch(target.url, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${text}`);
  }
  return target.resourceUrl;
}
