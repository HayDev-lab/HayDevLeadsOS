import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const imagePath = '/home/z/my-project/download/auto-qa/02-builder-empty.png';
const prompt = fs.readFileSync('/home/z/my-project/vlmqa_prompt.txt', 'utf8');
const b64 = fs.readFileSync(imagePath).toString('base64');
const deadline = Date.now() + 540000; // 9 min budget

const zai = await ZAI.create();
let attempt = 0;
while (Date.now() < deadline) {
  attempt++;
  try {
    const response = await zai.chat.completions.createVision({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
        ]
      }],
      thinking: { type: 'disabled' }
    });
    const content = response.choices[0]?.message?.content || '(empty)';
    fs.writeFileSync('/tmp/vlmqa/out_full.txt', content);
    console.log('=== SUCCESS on attempt', attempt, '===');
    console.log(content);
    process.exit(0);
  } catch (e) {
    console.error(`attempt ${attempt}: ${String(e.message).slice(0, 90)}`);
    if (Date.now() + 60000 > deadline) break;
    await new Promise(r => setTimeout(r, 60000));
  }
}
console.log('RATE_LIMITED: no success within budget');
process.exit(2);
