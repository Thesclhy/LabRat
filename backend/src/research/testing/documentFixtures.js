import { deflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import XLSX from "xlsx";

// Generated research notes, never copied from user/production documents.
export function syntheticDoc(text = "Protocol RQ-001\rTemperature: 80 C\r时间 30 分钟\r", { encrypted = false } = {}) {
  const content = Buffer.from(text, "utf16le");
  const word = Buffer.alloc(512 + content.length);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0x00c1, 2);
  word.writeUInt16LE(encrypted ? 0x0304 : 0x0204, 0x0a);
  word.writeUInt32LE(512, 0x18);
  word.writeUInt32LE(word.length, 0x1c);
  word.writeUInt32LE(text.length, 0x4c);
  word.writeUInt32LE(0, 0x1a2);
  word.writeUInt32LE(21, 0x1a6);
  content.copy(word, 512);
  const table = Buffer.alloc(21);
  table[0] = 2;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(0, 5);
  table.writeUInt32LE(text.length, 9);
  table.writeUInt32LE(512, 15);
  const compound = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(compound, "WordDocument", word);
  XLSX.CFB.utils.cfb_add(compound, "1Table", table);
  return Buffer.from(XLSX.CFB.write(compound, { type: "buffer" }));
}

export function syntheticDocx({ body, extras = {} } = {}) {
  const archive = XLSX.CFB.utils.cfb_new();
  const xml = body || '<w:p><w:r><w:t>Protocol RQ-001 中文方法</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Temperature</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>80 C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  XLSX.CFB.utils.cfb_add(archive, "word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`));
  for (const [name, value] of Object.entries(extras)) XLSX.CFB.utils.cfb_add(archive, name, Buffer.from(value));
  return Buffer.from(XLSX.CFB.write(archive, { type: "buffer", fileType: "zip" }));
}

export function scanCanvas({ chinese = false, turns = 0, lowContrast = false, columns = false, skew = 0, numericBlur = false } = {}) {
  const base = createCanvas(1200, 1600);
  const ctx = base.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, base.width, base.height);
  ctx.translate(600, 800); ctx.rotate(skew); ctx.translate(-600, -800);
  ctx.fillStyle = lowContrast ? "#fdfdfd" : "black";
  ctx.font = chinese ? '42px "Noto Sans CJK SC", "Microsoft YaHei", "SimSun", sans-serif' : "40px Arial, sans-serif";
  const lines = chinese ? ["实验方法 RQ-002", "温度 80 摄氏度", "反应时间 30 分钟", "样品编号 Exp17", "本文只描述方法，不代表实验结果。"]
    : ["Research protocol RQ-001", "Temperature: 80 C", "Duration: 30 minutes", "Sample: Exp17", "This procedure requires a dry sample."];
  lines.forEach((line, i) => ctx.fillText(line, 90, 140 + i * 90));
  if (numericBlur) {
    ctx.font = "34px Arial";
    ctx.fillStyle = "#f8f8f8";
    ctx.fillText("Concentration: -0.10 mg/mL", 90, 680);
  }
  if (columns) {
    ctx.font = "28px Arial";
    ctx.fillText("Control A: dry sample", 90, 800);
    ctx.fillText("Control B: wet sample", 690, 800);
    ctx.fillText("Duration: 30 minutes", 90, 855);
    ctx.fillText("Duration: 45 minutes", 690, 855);
  }
  if (!turns) return base;
  const rotated = createCanvas(turns % 2 ? 1600 : 1200, turns % 2 ? 1200 : 1600);
  const out = rotated.getContext("2d");
  out.translate(rotated.width / 2, rotated.height / 2); out.rotate(turns * Math.PI / 2);
  out.drawImage(base, -600, -800);
  return rotated;
}

export function syntheticPdf(pages = [{ text: ["Research protocol RQ-001", "Temperature: 80 C. Duration: 30 minutes."] }]) {
  const objects = [];
  const add = (value) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); return objects.length; };
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
  const catalog = add(""); const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const ids = [];
  for (const source of pages) {
    let resources = `/Font << /F1 ${font} 0 R >>`;
    let commands = "";
    if (source.scan) {
      const canvas = scanCanvas(source.scan);
      const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = Buffer.alloc(canvas.width * canvas.height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
      const image = add(stream(`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(rgb)));
      resources += ` /XObject << /Image ${image} 0 R >>`;
      commands += "q 600 0 0 800 0 0 cm /Image Do Q\n";
    }
    (source.text || []).forEach((line, i) => {
      const escaped = line.replace(/[\\()]/g, "\\$&");
      commands += `BT /F1 18 Tf 45 ${730 - i * 40} Td (${escaped}) Tj ET\n`;
    });
    const content = add(stream("", Buffer.from(commands)));
    ids.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 600 800] /Rotate ${source.rotation || 0} /Resources << ${resources} >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
  objects[pageTree - 1] = Buffer.from(`<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${ids.length} >>`);
  const parts = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let position = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const entry = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    parts.push(entry); position += entry.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${position}\n%%EOF`));
  return Buffer.concat(parts);
}
