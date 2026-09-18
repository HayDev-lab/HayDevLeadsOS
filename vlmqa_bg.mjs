import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const imagePath = process.argv[2];
const outPath = process.argv[3];
const prompt = fs.readFileSync('/home/z/my-project/vlmqa_prompt.txt', 'utf8');

const b64 = fs.readFileSync(imagePath).toString('base64');
const mime = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

function log(m) { fs.appendFileSync('/home/z/my-project/vlmqa_bg.log', new Date().toISOString() + ' ' + m + '\n'); }

async function main() {
  const zai = await ZAI.create();
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
          ]
        }],
        thinking: { type: 'disabled' }
      });
      const content = response.choices[0]?.message?.content || '(empty)';
      fs.writeFileSync(outPath, content);
      log('SUCCESS wrote ' + outPath);
      process.exit(0);
    } catch (e) {
      log(`attempt ${attempt} failed: ${String(e.message).slice(0, 100)}`);
      await new Promise(r => setTimeout(r, 45000));
    }
  }
  log('GAVE UP after ' + maxAttempts + ' attempts for ' + imagePath);
  process.exit(1);
}
main().catch(e => { log('FATAL ' + e.message); process.exit(1); });
