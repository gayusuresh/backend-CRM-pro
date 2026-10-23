// Starting points only. Operations can edit every field in the admin panel.
// VERIFY URLs, header names and response shapes against each vendor's current API docs
// before activating a client.
const pretty = (o) => JSON.stringify(o, null, 2);

const npfPayload = {
  college_id: '{{client.collegeId}}',
  name: '{{lead.name}}',
  email: '{{lead.email}}',
  mobile: '{{lead.mobile}}',
  state: '{{lead.state}}',
  city: '{{lead.city}}',
  campus: '{{lead.campus}}',
  course: '{{lead.course}}',
  specialization: '{{lead.specialization}}',
  source: '{{campaign.source}}',
  medium: '{{campaign.medium}}',
  campaign: '{{campaign.name}}',
};

module.exports = {
  npf: {
    label: 'NoPaperForms (NPF)',
    apiUrl: 'https://api.nopaperforms.com/lead/v1/createOrUpdate',
    method: 'POST',
    contentType: 'json',
    authType: 'none',
    headers: [
      { key: 'access-key', value: '{{secrets.accessKey}}' },
      { key: 'secret-key', value: '{{secrets.secretKey}}' },
    ],
    secretNames: ['accessKey', 'secretKey'],
    payloadTemplate: pretty(npfPayload),
    responseMapping: { externalIdPath: 'data.lead_id', errorPath: 'message' },
  },
  meritto: {
    label: 'Meritto',
    apiUrl: 'https://api.nopaperforms.com/lead/v1/createOrUpdate',
    method: 'POST',
    contentType: 'json',
    authType: 'none',
    headers: [
      { key: 'access-key', value: '{{secrets.accessKey}}' },
      { key: 'secret-key', value: '{{secrets.secretKey}}' },
    ],
    secretNames: ['accessKey', 'secretKey'],
    payloadTemplate: pretty(npfPayload),
    responseMapping: { externalIdPath: 'data.lead_id', errorPath: 'message' },
  },
  leadsquared: {
    label: 'LeadSquared',
    apiUrl: 'https://api.leadsquared.com/v2/LeadManagement.svc/Lead.Capture',
    method: 'POST',
    contentType: 'json',
    authType: 'none',
    queryParams: [
      { key: 'accessKey', value: '{{secrets.accessKey}}' },
      { key: 'secretKey', value: '{{secrets.secretKey}}' },
    ],
    secretNames: ['accessKey', 'secretKey'],
    payloadTemplate: pretty([
      { Attribute: 'FirstName', Value: '{{lead.name}}' },
      { Attribute: 'EmailAddress', Value: '{{lead.email}}' },
      { Attribute: 'Phone', Value: '{{lead.mobile}}' },
      { Attribute: 'mx_State', Value: '{{lead.state}}' },
      { Attribute: 'mx_City', Value: '{{lead.city}}' },
      { Attribute: 'mx_Course', Value: '{{lead.course}}' },
      { Attribute: 'Source', Value: '{{campaign.source}}' },
      { Attribute: 'SourceCampaign', Value: '{{campaign.name}}' },
    ]),
    responseMapping: { successPath: 'Status', successValue: 'Success', externalIdPath: 'Message.Id', errorPath: 'ExceptionMessage' },
  },
  zoho: {
    label: 'Zoho CRM',
    apiUrl: 'https://www.zohoapis.in/crm/v2/Leads',
    method: 'POST',
    contentType: 'json',
    authType: 'oauth2',
    oauth: { tokenUrl: 'https://accounts.zoho.in/oauth/v2/token', grantType: 'refresh_token', tokenPrefix: 'Zoho-oauthtoken' },
    secretNames: ['clientId', 'clientSecret', 'refreshToken'],
    payloadTemplate: pretty({
      data: [
        {
          Last_Name: '{{lead.name}}',
          Email: '{{lead.email}}',
          Mobile: '{{lead.mobile}}',
          State: '{{lead.state}}',
          City: '{{lead.city}}',
          Lead_Source: '{{campaign.source}}',
          Description: '{{lead.course}} / {{lead.specialization}} / {{campaign.name}}',
        },
      ],
    }),
    responseMapping: { successPath: 'data[0].code', successValue: 'SUCCESS', externalIdPath: 'data[0].details.id', errorPath: 'data[0].message' },
  },
  generic_rest: {
    label: 'Generic REST API',
    apiUrl: '',
    method: 'POST',
    contentType: 'json',
    authType: 'bearer',
    secretNames: ['token'],
    payloadTemplate: pretty({
      name: '{{lead.name}}',
      email: '{{lead.email}}',
      mobile: '{{lead.mobile}}',
      course: '{{lead.course}}',
      campaign: '{{campaign.name}}',
    }),
    responseMapping: { externalIdPath: 'id' },
  },
  generic_webhook: {
    label: 'Generic Webhook',
    apiUrl: '',
    method: 'POST',
    contentType: 'json',
    authType: 'none',
    secretNames: [],
    payloadTemplate: pretty({ lead: '{{lead}}', campaign: '{{campaign}}', sentAt: '{{now}}' }),
    responseMapping: {},
  },
};
