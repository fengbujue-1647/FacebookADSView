const ADD_TO_CART_TYPES = [
  'omni_add_to_cart',
  'add_to_cart',
  'offsite_conversion.fb_pixel_add_to_cart',
  'app_custom_event.fb_mobile_add_to_cart'
];

const CHECKOUT_TYPES = [
  'omni_initiated_checkout',
  'initiate_checkout',
  'offsite_conversion.fb_pixel_initiate_checkout',
  'app_custom_event.fb_mobile_initiated_checkout'
];

const PURCHASE_TYPES = [
  'omni_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'app_custom_event.fb_mobile_purchase'
];

const LEAD_TYPES = [
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.lead_grouped'
];

const LINK_CLICK_TYPES = [
  'link_click',
  'inline_link_click',
  'outbound_click'
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listToMap(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    if (!item?.action_type) continue;
    map.set(item.action_type, toNumber(item.value));
  }
  return map;
}

function firstValue(map, actionTypes) {
  for (const actionType of actionTypes) {
    if (map.has(actionType)) return { actionType, value: map.get(actionType) };
  }
  return { actionType: '', value: 0 };
}

function roasValue(row, purchaseValue, spend) {
  const candidates = [row.purchase_roas, row.website_purchase_roas];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      const preferred = firstValue(listToMap(candidate), PURCHASE_TYPES);
      if (preferred.value) return preferred.value;
      return toNumber(candidate[0]?.value);
    }
  }
  return spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0;
}

function selectResult({ actions, costs, spend, forcedAction }) {
  if (forcedAction) {
    const value = actions.get(forcedAction) || 0;
    return {
      result_type: forcedAction,
      result_count: value,
      cost_per_result: costs.get(forcedAction) || (value > 0 ? spend / value : 0)
    };
  }

  const groups = [
    PURCHASE_TYPES,
    ADD_TO_CART_TYPES,
    CHECKOUT_TYPES,
    LEAD_TYPES,
    LINK_CLICK_TYPES
  ];

  for (const group of groups) {
    const result = firstValue(actions, group);
    if (result.value > 0) {
      return {
        result_type: result.actionType,
        result_count: result.value,
        cost_per_result: costs.get(result.actionType) || (spend > 0 ? spend / result.value : 0)
      };
    }
  }

  return { result_type: '', result_count: 0, cost_per_result: 0 };
}

function hourStart(dateStart, hourlyRange) {
  if (!dateStart || !hourlyRange) return '';
  const match = String(hourlyRange).match(/^(\d{2}):/);
  if (!match) return '';
  return `${dateStart}T${match[1]}:00:00`;
}

export const insightColumns = [
  { key: 'date_start', header: '日期开始' },
  { key: 'date_stop', header: '日期结束' },
  { key: 'hourly_range', header: '小时区间' },
  { key: 'hour_start', header: '小时开始' },
  { key: 'account_id', header: '广告账户ID' },
  { key: 'account_name', header: '广告账户' },
  { key: 'campaign_id', header: '广告系列ID' },
  { key: 'campaign_name', header: '广告系列' },
  { key: 'adset_id', header: '广告组ID' },
  { key: 'adset_name', header: '广告组' },
  { key: 'ad_id', header: '广告ID' },
  { key: 'ad_name', header: '广告' },
  { key: 'effective_status', header: '投放' },
  { key: 'spend', header: '已花费金额' },
  { key: 'cpc', header: '单次点击费用(全部)' },
  { key: 'result_count', header: '成效' },
  { key: 'cost_per_result', header: '单次成效费用' },
  { key: 'add_to_cart_count', header: '加入购物车次数' },
  { key: 'initiate_checkout_count', header: '结账发起次数' },
  { key: 'purchase_count', header: '购买次数' },
  { key: 'purchase_value', header: '购买价值' },
  { key: 'roas', header: '广告花费回报(ROAS)' },
  { key: 'ctr', header: '点击率(全部)' },
  { key: 'clicks', header: '点击量(全部)' },
  { key: 'reach', header: '覆盖人数' },
  { key: 'impressions', header: '展示次数' },
  { key: 'frequency', header: '频次' },
  { key: 'result_type', header: '成效口径' }
];

export function normalizeInsight(row, { accountsById = new Map(), resourcesById = new Map(), resultAction = '' } = {}) {
  const actions = listToMap(row.actions);
  const costs = listToMap(row.cost_per_action_type);
  const values = listToMap(row.action_values);

  const addToCart = firstValue(actions, ADD_TO_CART_TYPES);
  const checkout = firstValue(actions, CHECKOUT_TYPES);
  const purchase = firstValue(actions, PURCHASE_TYPES);
  const purchaseValue = firstValue(values, PURCHASE_TYPES);
  const spend = toNumber(row.spend);
  const result = selectResult({ actions, costs, spend, forcedAction: resultAction });

  const resourceId = row.ad_id || row.adset_id || row.campaign_id || row.id;
  const resource = resourcesById.get(String(resourceId || '')) || {};
  const account = accountsById.get(String(row.account_id || resource.account_id || '')) || {};

  return {
    date_start: row.date_start || '',
    date_stop: row.date_stop || '',
    hourly_range: row.hourly_stats_aggregated_by_advertiser_time_zone || '',
    hour_start: hourStart(row.date_start, row.hourly_stats_aggregated_by_advertiser_time_zone),
    account_id: row.account_id || resource.account_id || '',
    account_name: row.account_name || account.name || '',
    campaign_id: row.campaign_id || resource.campaign_id || (row.campaign_name ? resource.id : ''),
    campaign_name: row.campaign_name || '',
    adset_id: row.adset_id || resource.adset_id || '',
    adset_name: row.adset_name || '',
    ad_id: row.ad_id || (resource.adset_id ? resource.id : ''),
    ad_name: row.ad_name || resource.name || '',
    effective_status: resource.effective_status || row.effective_status || '',
    spend,
    cpc: toNumber(row.cpc),
    result_count: result.result_count,
    cost_per_result: result.cost_per_result,
    add_to_cart_count: addToCart.value,
    initiate_checkout_count: checkout.value,
    purchase_count: purchase.value,
    purchase_value: purchaseValue.value,
    roas: roasValue(row, purchaseValue.value, spend),
    ctr: toNumber(row.ctr),
    clicks: toNumber(row.clicks),
    reach: toNumber(row.reach),
    impressions: toNumber(row.impressions),
    frequency: toNumber(row.frequency),
    result_type: result.result_type
  };
}
