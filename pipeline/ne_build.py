# -*- coding: utf-8 -*-
"""M6-2 离线装饰矢量：中国省份界线 + 世界主要河流 + 主要湖泊。

数据源 Natural Earth 10m（naciscdn.org 官方 CDN，可 Range 下载）：
  https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip
  https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip
  https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip
下载 zip 放本目录（pipeline/ne/*.zip，gitignored），此脚本只处理 shp → 简化 → GeoJSON。

选河策略：NE 把珠江/淮河/辽河/松花江标成高 scalerank(6-7)，且长江被拆成
Jinsha/Chang Jiang/Yangtze/无名段 等多个 feature——单看 scalerank 或单段长度都会漏/断。
所以用三条件兜底：①全球 sr<=3；②单段估算长度>=450km（保住世界干流与长无名段）；
③名称在中国/东亚主要河流名单（保珠江/淮河/海河/辽河/鸭绿江等短但重要的）。
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import zipfile, tempfile, os, json, math
import shapefile
from shapely.geometry import shape as shapely_shape
from shapely.ops import transform as shapely_transform

NE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(NE_DIR, '..', 'web', 'src', 'lib', 'geo')
os.makedirs(OUT_DIR, exist_ok=True)

def read_shp(zipname, shpname):
    with zipfile.ZipFile(zipname) as z:
        files = {n: z.read(n) for n in z.namelist()}
    d = tempfile.mkdtemp()
    base = os.path.join(d, 'data')
    for ext in ['shp', 'shx', 'dbf', 'prj', 'cpg']:
        n = shpname.replace('.shp', '.' + ext)
        if n in files:
            open(base + '.' + ext, 'wb').write(files[n])
    return shapefile.Reader(base)

def haversine_km(p1, p2):
    r = 6371.0
    lon1, lat1, lon2, lat2 = map(math.radians, [p1[0], p1[1], p2[0], p2[1]])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

def line_km(geom):
    def one(g):
        if g.geom_type == 'LineString':
            return sum(haversine_km(g.coords[i], g.coords[i + 1]) for i in range(len(g.coords) - 1))
        if g.geom_type == 'MultiLineString':
            return sum(one(x) for x in g.geoms)
        return 0.0
    return one(geom)

def simplify_gj(gj, tol):
    """对 GeoJSON 每个 feature 的 geometry 做 Douglas-Peucker 简化"""
    for f in gj['features']:
        g = shapely_shape(f['geometry'])
        s = g.simplify(tol, preserve_topology=True)
        f['geometry'] = json.loads(json.dumps(s.__geo_interface__))
    return gj

def drop_props(gj, keep=()):
    for f in gj['features']:
        f['properties'] = {k: f['properties'].get(k) for k in keep if k in f['properties']}
    return gj

def write(name, gj):
    path = os.path.join(OUT_DIR, name)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(gj, fh, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(path) / 1024
    n = len(gj['features'])
    print(f'  {name}: {n} features, {size:.0f} KB')
    return gj

# ---------- 1. 中国省份界线 ----------
print('== 省份 ==')
adm = read_shp(os.path.join(NE_DIR, 'ne', 'admin1.zip'), 'ne_10m_admin_1_states_provinces.shp')
af = [f[0] for f in adm.fields[1:]]
provs = {
    'type': 'FeatureCollection',
    'features': [],
}
for a in range(len(adm)):
    rec = adm.record(a)
    if rec[af.index('adm0_a3')] != 'CHN':
        continue
    provs['features'].append({
        'type': 'Feature',
        'properties': {'name': rec[af.index('name')], 'name_zh': rec[af.index('name_zh')]},
        'geometry': json.loads(json.dumps(shapely_shape(adm.shape(a).__geo_interface__).__geo_interface__)),
    })
write('chn-provinces.json', simplify_gj(drop_props(provs, ('name', 'name_zh')), 0.04))

# ---------- 2. 世界主要河流 ----------
print('== 河流 ==')
riv = read_shp(os.path.join(NE_DIR, 'ne', 'rivers.zip'), 'ne_10m_rivers_lake_centerlines.shp')
rf = [f[0] for f in riv.fields[1:]]
# 中国/东亚干流名单：按名称兜底（NE 拆段导致单段长度偏低，珠江/淮河/海河/辽河必须保）
CHINA_RIVERS = {
    'Huang', 'Yangtze', 'Chang Jiang', 'Jinsha', 'Yalong', 'Lancang', 'Mekong', 'Nu', 'Salween',
    'Amur', 'Songhua', "Di'er Songhua", 'Yarlung', 'Brahmaputra', 'Pearl', 'Xi', 'Liao', 'Xiliao',
    'Huai', 'Hai', 'Yalu', 'Tumen', 'Han', 'Xiang', 'Gan', 'Min', 'Wei', 'Ussuri', 'Yarlung Tsangpo',
    'Irtysh', 'Tarim', 'Helmand',
}
rivers = {'type': 'FeatureCollection', 'features': []}
for a in range(len(riv)):
    rec = riv.record(a)
    if rec[rf.index('featurecla')] != 'River':
        continue
    g = shapely_shape(riv.shape(a).__geo_interface__)
    km = line_km(g)
    sr = rec[rf.index('scalerank')]
    nm = rec[rf.index('name')]
    if sr <= 3 or km >= 1000 or nm in CHINA_RIVERS:
        rivers['features'].append({'type': 'Feature', 'properties': {'name': nm}, 'geometry': json.loads(json.dumps(g.__geo_interface__))})
print(f'  主要河流: {len(rivers["features"])} (sr<=3 或 >=1000km 或 中国名单)')
write('major-rivers.json', simplify_gj(drop_props(rivers, ('name',)), 0.03))

# ---------- 3. 主要湖泊 ----------
print('== 湖泊 ==')
lk = read_shp(os.path.join(NE_DIR, 'ne', 'lakes.zip'), 'ne_10m_lakes.shp')
lf = [f[0] for f in lk.fields[1:]]
# 中国湖泊名单：NE 给中国大湖标 sr>=3（青海湖/鄱阳湖/洞庭湖都超 2），单靠 sr 会漏——名字兜底
CHINA_LAKES = {
    'Qinghai Hu', 'Poyang Hu', 'Dongting Hu', 'Hongze Hu', 'Chao Hu',
    'Nam Co', 'Siling Co', 'Bosten Hu', 'Ebinur Hu', 'Taihu', 'Lop Nur', 'Lake Khanka', 'Xingkai Hu',
}
lakes = {'type': 'FeatureCollection', 'features': []}
for a in range(len(lk)):
    rec = lk.record(a)
    sr = rec[lf.index('scalerank')]
    nm = rec[lf.index('name')]
    if sr <= 2 or nm in CHINA_LAKES:
        lakes['features'].append({'type': 'Feature', 'properties': {'name': nm}, 'geometry': json.loads(json.dumps(shapely_shape(lk.shape(a).__geo_interface__).__geo_interface__))})
write('major-lakes.json', simplify_gj(drop_props(lakes, ('name',)), 0.05))
