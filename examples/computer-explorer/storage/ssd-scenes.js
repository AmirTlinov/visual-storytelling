import { R, G, repeat, P, gate } from '../drawing/symbols.js';
import { nvmeSsdArt, sataSsdArt, ssdLayouts, sataConnector } from './art.js';

const ssdSceneTypes = new Set([
  'sata-ssd',
  'nvme-ssd',
  'ssd-controller',
  'storage-interface',
  'ssd-ftl',
  'ssd-ecc',
]);
function ssdScene(node, { scene, T, H, ctx, array, tile, bus, arrow }) {
  const drive = node.drive || 'sata',
    nvme = drive === 'nvme';
  const hit = (key, label, type, x, y, w, h, params = {}) =>
    H(key, label, type, x, y, w, h, { drive, ...params });
  let b = '';
  if (node.type === 'sata-ssd' || node.type === 'nvme-ssd') {
    b = (nvme ? nvmeSsdArt(ctx) : sataSsdArt({ ...ctx, inside: true })).body;
    const p = ssdLayouts[drive];
    for (const [key, label, type] of [
      ['controller', 'Контроллер SSD', 'ssd-controller'],
      ['dram', 'DRAM · таблицы и буфер', 'dram'],
      ['interface', nvme ? 'M.2 / PCIe / NVMe' : 'Разъёмы SATA', 'storage-interface'],
    ]) {
      const r = p[key];
      hit(key, label, type, r.x, r.y, r.w, r.h);
    }
    p.nand.forEach((r, i) =>
      hit(`nand-${i}`, `NAND ${i + 1}`, 'nand-package', r.x, r.y, r.w, r.h, { chip: i }),
    );
    if (nvme) hit('power', 'Управление питанием', 'controller', 490, 80, 39, 78);
    scene.caption = nvme
      ? 'SSD M.2 2280: плата 22 × 80 мм, ключ M, PCIe ×4 и протокол NVMe. Показан вариант с DRAM; существуют и DRAM-less SSD. M.2 также бывает SATA.'
      : 'SATA SSD 2.5″ со снятой крышкой: контроллер, DRAM и корпуса NAND. DRAM хранит рабочие таблицы и буферы; данные сохраняет NAND. Компоновка условная.';
  } else if (node.type === 'ssd-controller') {
    b = R(33, 26, 534, 308, 'board outline', 6) + R(47, 40, 506, 278, 'chip fine', 3);
    b += G('interface', tile(67, 60, 143, 57, nvme ? 'NVMe / PCIe' : 'SATA / NCQ', 'metal-hi'));
    b +=
      G('ftl', tile(67, 147, 143, 67, 'FTL', 'metal-hi')) +
      G('buffer', array(67, 243, 143, 50, 3, 8));
    b += G('ecc', tile(279, 60, 245, 65, 'ECC · BCH / LDPC', 'metal-hi'));
    b +=
      G(
        'channels',
        R(279, 159, 245, 134, 'die fine', 3) +
          repeat(4, (i) => R(292 + i * 58, 180, 46, 77, 'chip fine', 2)),
      ) + T(403, 272, 'КАНАЛЫ NAND', 14);
    b += P('M 210 89 H 245 V 263 H 210 M 245 180 H 279 M 210 180 H 245 M 403 125 V 159', 'edge');
    hit('interface', nvme ? 'Очереди NVMe' : 'Команды SATA', 'storage-interface', 67, 60, 143, 57);
    hit('ftl', 'Трансляция адресов FTL', 'ssd-ftl', 67, 147, 143, 67);
    hit('buffer', 'Буфер контроллера · SRAM', 'array', 67, 243, 143, 50, { memory: 'sram' });
    hit('ecc', 'Коррекция ошибок', 'ssd-ecc', 279, 60, 245, 65);
    hit('channels', 'Каналы к NAND', 'nand-package', 279, 159, 245, 134, { chip: 0 });
    scene.caption =
      'Контроллер переводит логические адреса через FTL, исправляет ошибки ECC и распределяет работу по каналам NAND. Wear leveling и сборка мусора управляют физическими блоками.';
  } else if (node.type === 'storage-interface') {
    if (nvme) {
      b = R(37, 28, 526, 132, 'board outline', 4) + T(300, 46, 'ПАМЯТЬ ХОСТА', 16);
      b +=
        G('submission', array(61, 71, 207, 66, 3, 8)) +
        G('completion', array(331, 71, 207, 66, 3, 8)) +
        T(165, 149, 'Submission queue', 14) +
        T(434, 149, 'Completion queue', 14);
      b +=
        P('M 165 165 V 213 H 254 M 345 247 H 434 V 165', 'line') +
        arrow(245, 213) +
        arrow(434, 171, 'up');
      b +=
        G('controller', R(253, 194, 93, 96, 'chip outline', 4)) +
        T(299, 223, 'NVMe', 17, 'etch') +
        T(299, 257, 'CTRL', 16, 'etch');
      b +=
        T(112, 234, 'Doorbell', 14) +
        T(486, 234, 'DMA / MSI-X', 14) +
        T(300, 324, 'PCIe · чтение и запись памяти хоста', 15);
      hit('submission', 'Буфер команд в DRAM', 'dram', 61, 71, 207, 66);
      hit('completion', 'Буфер завершений в DRAM', 'dram', 331, 71, 207, 66);
      hit('controller', 'Логика контроллера', 'controller', 253, 194, 93, 96);
      scene.caption =
        'Хост кладёт команду в SQ и сообщает через doorbell. Контроллер читает её, выполняет передачу DMA и пишет результат в CQ. M.2 описывает разъём и размеры; NVMe — команды.';
    } else {
      b = G('data', sataConnector(T, 151, 87));
      b += T(300, 35, 'SATA · ДАННЫЕ И ПИТАНИЕ', 19);
      b += P('M 191 115 V 174 H 98 V 203 M 329 115 V 176 H 459 V 203', 'line');
      b +=
        G('controller', tile(45, 203, 225, 91, 'SATA HOST', 'metal')) +
        G('power', tile(353, 203, 198, 91, 'ПИТАНИЕ', 'metal'));
      b += T(157, 316, 'TX± · RX± · GND', 15) + T(450, 316, 'от блока питания', 14);
      hit('controller', 'Контроллер SATA', 'controller', 45, 203, 225, 91);
      scene.caption =
        'Сигнальный разъём SATA имеет 7 контактов: две дифференциальные пары и земля. Отдельный разъём питания имеет 15 контактов. HDD и SATA SSD используют один интерфейс данных.';
    }
  } else if (node.type === 'ssd-ftl') {
    b = T(143, 35, 'ЛОГИЧЕСКИЙ АДРЕС', 16) + T(444, 35, 'ФИЗИЧЕСКАЯ СТРАНИЦА', 16);
    for (let i = 0; i < 4; i++) {
      const y = 68 + i * 65,
        j = [2, 0, 3, 1][i],
        yy = 68 + j * 65;
      b +=
        G(`lba-${i}`, tile(53, y, 171, 43, `LBA ${i}`)) +
        G(`page-${i}`, R(373, y, 176, 43, 'chip outline', 2)) +
        T(461, y + 22, `D${Math.floor(i / 2)} · B${i % 2} · P0`, 14, 'etch');
      b += P(`M 224 ${y + 22} H ${255 + i * 22} V ${yy + 22} H 373`, 'trace') + arrow(368, yy + 22);
      hit(`page-${i}`, `Физический блок ${i % 2}`, 'nand-block', 373, y, 176, 43, {
        chip: 0,
        die: Math.floor(i / 2),
        plane: 0,
        block: i % 2,
      });
    }
    scene.caption =
      'LBA адресует данные для ОС. FTL отображает их на страницы NAND; перезапись обычно размещает новую страницу, а старую помечает недействительной. Блок стирается при сборке мусора.';
  } else if (node.type === 'ssd-ecc') {
    b = G('data', array(44, 55, 188, 94, 4, 8)) + T(138, 33, 'ДАННЫЕ', 16);
    b += G('parity', array(368, 55, 188, 94, 4, 8)) + T(462, 33, 'ПРОВЕРОЧНЫЕ БИТЫ', 15);
    b += bus(232, 103, 368, 103) + arrow(359, 103) + T(300, 80, 'Кодер', 14);
    b += P('M 138 149 V 236 H 225 M 462 149 V 236 H 373', 'line');
    b +=
      G(
        'xor',
        gate({ T: () => '' }, 'xor').body,
        'translate(215 188) scale(.65) translate(-77 -72)',
      ) + T(300, 309, 'ПРОВЕРКА ЧЁТНОСТИ', 15);
    hit('xor', 'XOR · элемент проверки', 'gate', 217, 183, 158, 95, { op: 'XOR' });
    scene.caption = `ECC добавляет избыточность и помогает обнаруживать и исправлять ошибки чтения ${node.medium === 'hdd' ? 'магнитного слоя' : 'NAND'}. Здесь показан один XOR-паритет; реальные коды содержат множество проверок.`;
  }
  scene.body = b;
  return scene;
}
export { ssdSceneTypes, ssdScene };
