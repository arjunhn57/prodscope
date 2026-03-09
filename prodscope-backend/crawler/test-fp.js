const f = require('./fingerprint');
const SAMPLE_XML_1_DIFFERENT_NUMBERS = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false">
      <node text="11:45 AM" class="SysTime" />
    </node>
    <node index="1" text="" resource-id="com.example:id/email1" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login 2" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;
console.log(f.normalize(SAMPLE_XML_1_DIFFERENT_NUMBERS));
