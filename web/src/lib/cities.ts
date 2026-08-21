// M5 城市搜索内置数据集：中国主要城市 + 世界主要城市（经纬度），离线可搜
// 无外部 geocoding API；搜索按 name（中文）+ pinyin（拼音）子串匹配

export interface City {
  name: string;   // 中文名（世界城市用音译）
  pinyin: string; // 拼音（搜索用）
  country: string; // 国家/地区
  lon: number;
  lat: number;
  /** M6 标注分级：0=世界大城市(zoom≥2.5) 1=亚洲区域性(zoom≥4) 2=其余(zoom≥6) */
  tier: number;
}

export const CITIES: City[] = [
  // ---- 中国（34 省级行政中心 + 部分大城市）----
  { name: '北京', pinyin: 'beijing', country: '中国', lon: 116.4, lat: 39.9, tier: 0 },
  { name: '上海', pinyin: 'shanghai', country: '中国', lon: 121.5, lat: 31.2, tier: 0 },
  { name: '天津', pinyin: 'tianjin', country: '中国', lon: 117.2, lat: 39.1, tier: 1 },
  { name: '重庆', pinyin: 'chongqing', country: '中国', lon: 106.5, lat: 29.6, tier: 1 },
  { name: '广州', pinyin: 'guangzhou', country: '中国', lon: 113.3, lat: 23.1, tier: 1 },
  { name: '深圳', pinyin: 'shenzhen', country: '中国', lon: 114.1, lat: 22.6, tier: 1 },
  { name: '成都', pinyin: 'chengdu', country: '中国', lon: 104.1, lat: 30.7, tier: 1 },
  { name: '杭州', pinyin: 'hangzhou', country: '中国', lon: 120.2, lat: 30.3, tier: 1 },
  { name: '武汉', pinyin: 'wuhan', country: '中国', lon: 114.3, lat: 30.6, tier: 1 },
  { name: '西安', pinyin: 'xian', country: '中国', lon: 108.9, lat: 34.3, tier: 1 },
  { name: '南京', pinyin: 'nanjing', country: '中国', lon: 118.8, lat: 32.1, tier: 1 },
  { name: '苏州', pinyin: 'suzhou', country: '中国', lon: 120.6, lat: 31.3, tier: 1 },
  { name: '郑州', pinyin: 'zhengzhou', country: '中国', lon: 113.6, lat: 34.7, tier: 1 },
  { name: '长沙', pinyin: 'changsha', country: '中国', lon: 113.0, lat: 28.2, tier: 1 },
  { name: '合肥', pinyin: 'hefei', country: '中国', lon: 117.2, lat: 31.9, tier: 1 },
  { name: '沈阳', pinyin: 'shenyang', country: '中国', lon: 123.4, lat: 41.8, tier: 1 },
  { name: '哈尔滨', pinyin: 'haerbin', country: '中国', lon: 126.6, lat: 45.8, tier: 1 },
  { name: '长春', pinyin: 'changchun', country: '中国', lon: 125.3, lat: 43.9, tier: 1 },
  { name: '石家庄', pinyin: 'shijiazhuang', country: '中国', lon: 114.5, lat: 38.0, tier: 1 },
  { name: '太原', pinyin: 'taiyuan', country: '中国', lon: 112.6, lat: 37.9, tier: 1 },
  { name: '济南', pinyin: 'jinan', country: '中国', lon: 117.0, lat: 36.7, tier: 1 },
  { name: '青岛', pinyin: 'qingdao', country: '中国', lon: 120.4, lat: 36.1, tier: 1 },
  { name: '福州', pinyin: 'fuzhou', country: '中国', lon: 119.3, lat: 26.1, tier: 1 },
  { name: '厦门', pinyin: 'xiamen', country: '中国', lon: 118.1, lat: 24.5, tier: 1 },
  { name: '南昌', pinyin: 'nanchang', country: '中国', lon: 115.9, lat: 28.7, tier: 1 },
  { name: '昆明', pinyin: 'kunming', country: '中国', lon: 102.7, lat: 25.0, tier: 1 },
  { name: '贵阳', pinyin: 'guiyang', country: '中国', lon: 106.7, lat: 26.6, tier: 1 },
  { name: '南宁', pinyin: 'nanning', country: '中国', lon: 108.3, lat: 22.8, tier: 1 },
  { name: '海口', pinyin: 'haikou', country: '中国', lon: 110.3, lat: 20.0, tier: 1 },
  { name: '三亚', pinyin: 'sanya', country: '中国', lon: 109.5, lat: 18.3, tier: 1 },
  { name: '呼和浩特', pinyin: 'huhehaote', country: '中国', lon: 111.7, lat: 40.8, tier: 1 },
  { name: '兰州', pinyin: 'lanzhou', country: '中国', lon: 103.8, lat: 36.1, tier: 1 },
  { name: '西宁', pinyin: 'xining', country: '中国', lon: 101.8, lat: 36.6, tier: 1 },
  { name: '银川', pinyin: 'yinchuan', country: '中国', lon: 106.2, lat: 38.5, tier: 1 },
  { name: '乌鲁木齐', pinyin: 'wulumuqi', country: '中国', lon: 87.6, lat: 43.8, tier: 1 },
  { name: '拉萨', pinyin: 'lasa', country: '中国', lon: 91.1, lat: 29.7, tier: 1 },
  { name: '香港', pinyin: 'xianggang', country: '中国', lon: 114.2, lat: 22.3, tier: 0 },
  { name: '澳门', pinyin: 'aomen', country: '中国', lon: 113.5, lat: 22.2, tier: 1 },
  { name: '台北', pinyin: 'taibei', country: '中国', lon: 121.5, lat: 25.0, tier: 0 },
  { name: '大连', pinyin: 'dalian', country: '中国', lon: 121.6, lat: 38.9, tier: 1 },
  { name: '宁波', pinyin: 'ningbo', country: '中国', lon: 121.5, lat: 29.9, tier: 1 },
  { name: '无锡', pinyin: 'wuxi', country: '中国', lon: 120.3, lat: 31.6, tier: 1 },
  { name: '佛山', pinyin: 'foshan', country: '中国', lon: 113.1, lat: 23.0, tier: 1 },
  { name: '东莞', pinyin: 'dongguan', country: '中国', lon: 113.7, lat: 23.0, tier: 1 },
  { name: '珠海', pinyin: 'zhuhai', country: '中国', lon: 113.6, lat: 22.3, tier: 1 },
  { name: '桂林', pinyin: 'guilin', country: '中国', lon: 110.3, lat: 25.3, tier: 1 },
  { name: '黄山', pinyin: 'huangshan', country: '中国', lon: 118.3, lat: 29.7, tier: 1 },

  // ---- 东亚 / 东南亚 ----
  { name: '东京', pinyin: 'dongjing', country: '日本', lon: 139.7, lat: 35.7, tier: 0 },
  { name: '大阪', pinyin: 'daban', country: '日本', lon: 135.5, lat: 34.7, tier: 1 },
  { name: '首尔', pinyin: 'shouer', country: '韩国', lon: 127.0, lat: 37.6, tier: 0 },
  { name: '釜山', pinyin: 'fushan', country: '韩国', lon: 129.0, lat: 35.2, tier: 1 },
  { name: '平壤', pinyin: 'pingrang', country: '朝鲜', lon: 125.8, lat: 39.0, tier: 1 },
  { name: '曼谷', pinyin: 'mangu', country: '泰国', lon: 100.5, lat: 13.8, tier: 0 },
  { name: '河内', pinyin: 'hene', country: '越南', lon: 105.8, lat: 21.0, tier: 1 },
  { name: '胡志明市', pinyin: 'huzhimingshi', country: '越南', lon: 106.7, lat: 10.8, tier: 1 },
  { name: '马尼拉', pinyin: 'manila', country: '菲律宾', lon: 121.0, lat: 14.6, tier: 0 },
  { name: '新加坡', pinyin: 'xinjiapo', country: '新加坡', lon: 103.8, lat: 1.35, tier: 0 },
  { name: '雅加达', pinyin: 'yajiada', country: '印度尼西亚', lon: 106.8, lat: -6.2, tier: 0 },
  { name: '吉隆坡', pinyin: 'jilongpo', country: '马来西亚', lon: 101.7, lat: 3.1, tier: 0 },
  { name: '仰光', pinyin: 'yangguang', country: '缅甸', lon: 96.2, lat: 16.8, tier: 1 },
  { name: '加德满都', pinyin: 'jiedemudu', country: '尼泊尔', lon: 85.3, lat: 27.7, tier: 1 },

  // ---- 南亚 / 中亚 ----
  { name: '新德里', pinyin: 'xindeli', country: '印度', lon: 77.2, lat: 28.6, tier: 0 },
  { name: '孟买', pinyin: 'mengmai', country: '印度', lon: 72.9, lat: 19.1, tier: 0 },
  { name: '卡拉奇', pinyin: 'kalaqi', country: '巴基斯坦', lon: 67.0, lat: 24.9, tier: 1 },
  { name: '伊斯兰堡', pinyin: 'yisilanbao', country: '巴基斯坦', lon: 73.1, lat: 33.7, tier: 1 },
  { name: '达卡', pinyin: 'daka', country: '孟加拉国', lon: 90.4, lat: 23.8, tier: 1 },
  { name: '科伦坡', pinyin: 'kelunpo', country: '斯里兰卡', lon: 79.9, lat: 6.9, tier: 1 },
  { name: '阿拉木图', pinyin: 'alamutu', country: '哈萨克斯坦', lon: 76.9, lat: 43.2, tier: 1 },

  // ---- 中东 ----
  { name: '迪拜', pinyin: 'dibai', country: '阿联酋', lon: 55.3, lat: 25.2, tier: 0 },
  { name: '利雅得', pinyin: 'liyade', country: '沙特阿拉伯', lon: 46.7, lat: 24.7, tier: 0 },
  { name: '德黑兰', pinyin: 'deheilan', country: '伊朗', lon: 51.4, lat: 35.7, tier: 0 },
  { name: '伊斯坦布尔', pinyin: "yisitanbu'er", country: '土耳其', lon: 29.0, lat: 41.0, tier: 0 },

  // ---- 欧洲 ----
  { name: '伦敦', pinyin: 'lundun', country: '英国', lon: -0.1, lat: 51.5, tier: 0 },
  { name: '巴黎', pinyin: 'bali', country: '法国', lon: 2.35, lat: 48.9, tier: 0 },
  { name: '柏林', pinyin: 'bolin', country: '德国', lon: 13.4, lat: 52.5, tier: 0 },
  { name: '慕尼黑', pinyin: 'munihei', country: '德国', lon: 11.6, lat: 48.1, tier: 2 },
  { name: '莫斯科', pinyin: 'mosike', country: '俄罗斯', lon: 37.6, lat: 55.8, tier: 0 },
  { name: '罗马', pinyin: 'luoma', country: '意大利', lon: 12.5, lat: 41.9, tier: 0 },
  { name: '马德里', pinyin: 'madeli', country: '西班牙', lon: -3.7, lat: 40.4, tier: 0 },
  { name: '阿姆斯特丹', pinyin: 'amushitedan', country: '荷兰', lon: 4.9, lat: 52.4, tier: 0 },
  { name: '布鲁塞尔', pinyin: 'bilusaier', country: '比利时', lon: 4.35, lat: 50.8, tier: 2 },
  { name: '维也纳', pinyin: 'weiyena', country: '奥地利', lon: 16.4, lat: 48.2, tier: 0 },
  { name: '苏黎世', pinyin: 'sulishi', country: '瑞士', lon: 8.5, lat: 47.4, tier: 2 },
  { name: '雅典', pinyin: 'yadian', country: '希腊', lon: 23.7, lat: 38.0, tier: 0 },
  { name: '斯德哥尔摩', pinyin: 'sidegem', country: '瑞典', lon: 18.1, lat: 59.3, tier: 0 },
  { name: '哥本哈根', pinyin: 'gebenhagen', country: '丹麦', lon: 12.6, lat: 55.7, tier: 2 },
  { name: '赫尔辛基', pinyin: "he'erchenji", country: '芬兰', lon: 24.9, lat: 60.2, tier: 2 },
  { name: '华沙', pinyin: 'huasha', country: '波兰', lon: 21.0, lat: 52.2, tier: 0 },
  { name: '布拉格', pinyin: 'bula ge', country: '捷克', lon: 14.4, lat: 50.1, tier: 2 },

  // ---- 北美洲 ----
  { name: '纽约', pinyin: 'niuyue', country: '美国', lon: -74.0, lat: 40.7, tier: 0 },
  { name: '洛杉矶', pinyin: 'luoshanji', country: '美国', lon: -118.2, lat: 34.1, tier: 0 },
  { name: '芝加哥', pinyin: 'zhijiage', country: '美国', lon: -87.6, lat: 41.9, tier: 0 },
  { name: '休斯敦', pinyin: 'xiusidun', country: '美国', lon: -95.4, lat: 29.8, tier: 2 },
  { name: '西雅图', pinyin: 'xiyatu', country: '美国', lon: -122.3, lat: 47.6, tier: 2 },
  { name: '旧金山', pinyin: 'jiusanshan', country: '美国', lon: -122.4, lat: 37.8, tier: 0 },
  { name: '华盛顿', pinyin: 'huashengdun', country: '美国', lon: -77.0, lat: 38.9, tier: 0 },
  { name: '迈阿密', pinyin: "mai'ami", country: '美国', lon: -80.2, lat: 25.8, tier: 0 },
  { name: '多伦多', pinyin: 'duolunduo', country: '加拿大', lon: -79.4, lat: 43.7, tier: 0 },
  { name: '温哥华', pinyin: 'wengehua', country: '加拿大', lon: -123.1, lat: 49.3, tier: 0 },
  { name: '蒙特利尔', pinyin: 'mengteil', country: '加拿大', lon: -73.6, lat: 45.5, tier: 2 },
  { name: '墨西哥城', pinyin: 'moxigecheng', country: '墨西哥', lon: -99.1, lat: 19.4, tier: 0 },
  { name: '檀香山', pinyin: 'tanxiangshan', country: '美国', lon: -157.9, lat: 21.3, tier: 2 },

  // ---- 南美洲 ----
  { name: '圣保罗', pinyin: 'shengbaoluo', country: '巴西', lon: -46.6, lat: -23.5, tier: 0 },
  { name: '里约热内卢', pinyin: 'liyuerneilu', country: '巴西', lon: -43.2, lat: -22.9, tier: 2 },
  { name: '布宜诺斯艾利斯', pinyin: 'buyinuosialisi', country: '阿根廷', lon: -58.4, lat: -34.6, tier: 0 },
  { name: '利马', pinyin: 'lima', country: '秘鲁', lon: -77.0, lat: -12.0, tier: 0 },
  { name: '圣地亚哥', pinyin: 'shengdiyage', country: '智利', lon: -70.7, lat: -33.5, tier: 0 },
  { name: '波哥大', pinyin: 'bogeda', country: '哥伦比亚', lon: -74.1, lat: 4.6, tier: 2 },

  // ---- 非洲 ----
  { name: '开罗', pinyin: 'kailuo', country: '埃及', lon: 31.2, lat: 30.0, tier: 0 },
  { name: '开普敦', pinyin: 'kaipudun', country: '南非', lon: 18.4, lat: -33.9, tier: 2 },
  { name: '约翰内斯堡', pinyin: 'yuehanneisibao', country: '南非', lon: 28.0, lat: -26.2, tier: 0 },
  { name: '内罗毕', pinyin: 'neiluobi', country: '肯尼亚', lon: 36.8, lat: -1.3, tier: 2 },
  { name: '拉各斯', pinyin: 'lagesi', country: '尼日利亚', lon: 3.4, lat: 6.5, tier: 0 },

  // ---- 大洋洲 ----
  { name: '悉尼', pinyin: 'xini', country: '澳大利亚', lon: 151.2, lat: -33.9, tier: 0 },
  { name: '墨尔本', pinyin: 'moerben', country: '澳大利亚', lon: 145.0, lat: -37.8, tier: 0 },
  { name: '珀斯', pinyin: 'posi', country: '澳大利亚', lon: 115.9, lat: -31.9, tier: 2 },
  { name: '布里斯班', pinyin: 'bulisiban', country: '澳大利亚', lon: 153.0, lat: -27.5, tier: 2 },
  { name: '奥克兰', pinyin: 'aokelan', country: '新西兰', lon: 174.8, lat: -36.8, tier: 0 },
];

/** 按 name/pinyin 子串过滤（忽略大小写），最多返回 limit 条 */
export function searchCities(q: string, limit = 8): City[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return CITIES.filter(
    (c) => c.name.includes(s) || c.pinyin.includes(s),
  ).slice(0, limit);
}
