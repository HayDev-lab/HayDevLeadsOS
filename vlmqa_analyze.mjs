import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const imagePath = process.argv[2];
const prompt = fs.readFileSync('/tmp/vlmqa/prompt.txt', 'utf8');

const b64 = fs.readFileSync(imagePath).toString('base64');
const mime = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

async function main() {
  const zai = await ZAI.create();
  const maxAttempts = 12;
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
      console.log(content);
      fs.writeFileSync('/tmp/vlmqa/out_' + imagePath.split('/').pop().replace('.png','') + '.txt', content);
      return;
    } catch (e) {
      const is429 = String(e.message).includes('429');
      console.error(`Attempt ${attempt} failed: ${e.message.slice(0, 120)}`);
      if (attempt === maxAttempts) { process.exit(1); }
      const wait = is429 ? 45000 * attempt : 10000;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
