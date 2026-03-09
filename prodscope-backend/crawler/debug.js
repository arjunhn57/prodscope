const f = require('./fingerprint');

const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false">
      <node text="11:45 AM" class="SysTime" />
    </node>
    <node index="1" text="" resource-id="com.example:id/email1" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login 2" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

const xml2 = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false">
      <node text="12:00 PM" class="SysTime" />
    </node>
    <node index="1" text="" resource-id="com.example:id/email9" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login 9" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

const n1 = f.normalize(xml1);
const n2 = f.normalize(xml2);

let diffs = 0;
for (let i = 0; i < Math.max(n1.length, n2.length); i++) {
  if (n1[i] !== n2[i]) {
    diffs++;
    console.log('Diff at index', i, ':', 
      JSON.stringify(n1.substring(i-5, i+15)), 
      'vs', 
      JSON.stringify(n2.substring(i-5, i+15))
    );
    if(diffs > 2) break;
  }
}
if (diffs === 0) console.log("EXACTLY EQUAL");
