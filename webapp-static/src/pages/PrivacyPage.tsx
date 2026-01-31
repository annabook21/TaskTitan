export function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-slate-400 mb-8">Last updated: January 2026</p>

      <div className="space-y-8">
        {/* Introduction */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Introduction</h2>
          <p className="text-slate-300 leading-relaxed">
            TaskTitan ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our project management application.
          </p>
        </section>

        {/* Information We Collect */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Information We Collect</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-white mb-2">Account Information</h3>
              <p className="text-slate-300 leading-relaxed">
                When you create an account, we collect your email address, name, and authentication credentials. We use Amazon Cognito for secure authentication.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-white mb-2">Project Data</h3>
              <p className="text-slate-300 leading-relaxed">
                We store the projects, components, teams, and other content you create within the application. This data is necessary to provide our services.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-white mb-2">Usage Information</h3>
              <p className="text-slate-300 leading-relaxed">
                We collect information about how you interact with our application, including features used, pages visited, and actions taken. This helps us improve the service.
              </p>
            </div>
          </div>
        </section>

        {/* How We Use Your Information */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">How We Use Your Information</h2>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li>To provide and maintain our service</li>
            <li>To authenticate your identity and manage your account</li>
            <li>To enable collaboration features with your team members</li>
            <li>To power AI features using Amazon Bedrock (your prompts may be processed by AI models)</li>
            <li>To analyze usage patterns and improve our application</li>
            <li>To communicate with you about service updates and changes</li>
            <li>To comply with legal obligations</li>
          </ul>
        </section>

        {/* AI Features */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">AI Features</h2>
          <p className="text-slate-300 leading-relaxed mb-3">
            TaskTitan uses Amazon Bedrock to provide AI-powered features. When you use these features:
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li>Your prompts and project context are sent to Amazon Bedrock for processing</li>
            <li>AI responses are generated based on your input and returned to the application</li>
            <li>We do not use your data to train AI models</li>
            <li>Amazon Bedrock processes data in accordance with AWS's privacy practices</li>
          </ul>
        </section>

        {/* Data Storage and Security */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Data Storage and Security</h2>
          <p className="text-slate-300 leading-relaxed mb-3">
            We take data security seriously and implement appropriate measures to protect your information:
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li>Data is stored in Amazon DynamoDB with encryption at rest</li>
            <li>All data transmission is encrypted using TLS/HTTPS</li>
            <li>Authentication is handled by Amazon Cognito with industry-standard security</li>
            <li>We use AWS infrastructure with SOC 2 and ISO 27001 compliance</li>
            <li>Access to production data is restricted and audited</li>
          </ul>
        </section>

        {/* Data Sharing */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Data Sharing</h2>
          <p className="text-slate-300 leading-relaxed mb-3">
            We do not sell your personal information. We may share data in the following circumstances:
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li><strong className="text-white">With team members:</strong> Project data is shared with users who are members of the same team</li>
            <li><strong className="text-white">Service providers:</strong> We use AWS services to operate our application</li>
            <li><strong className="text-white">Legal requirements:</strong> We may disclose data if required by law or valid legal process</li>
          </ul>
        </section>

        {/* Your Rights */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Your Rights</h2>
          <p className="text-slate-300 leading-relaxed mb-3">
            You have the following rights regarding your data:
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li><strong className="text-white">Access:</strong> Request a copy of your personal data</li>
            <li><strong className="text-white">Correction:</strong> Request correction of inaccurate data</li>
            <li><strong className="text-white">Deletion:</strong> Request deletion of your account and associated data</li>
            <li><strong className="text-white">Export:</strong> Request export of your data in a portable format</li>
          </ul>
          <p className="text-slate-300 leading-relaxed mt-3">
            To exercise these rights, please contact us at{' '}
            <a href="mailto:privacy@tasktitan.dev" className="text-cyan-400 hover:underline">
              privacy@tasktitan.dev
            </a>
          </p>
        </section>

        {/* Data Retention */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Data Retention</h2>
          <p className="text-slate-300 leading-relaxed">
            We retain your data for as long as your account is active or as needed to provide services. If you delete your account, we will delete your personal data within 30 days, except where we are required to retain it for legal purposes.
          </p>
        </section>

        {/* Cookies */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Cookies and Local Storage</h2>
          <p className="text-slate-300 leading-relaxed">
            We use cookies and local storage to maintain your session and preferences. These are essential for the application to function properly. We do not use third-party tracking cookies.
          </p>
        </section>

        {/* Children's Privacy */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Children's Privacy</h2>
          <p className="text-slate-300 leading-relaxed">
            TaskTitan is not intended for users under 16 years of age. We do not knowingly collect personal information from children. If you believe we have collected such information, please contact us immediately.
          </p>
        </section>

        {/* Changes */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Changes to This Policy</h2>
          <p className="text-slate-300 leading-relaxed">
            We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last updated" date.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-xl font-semibold text-cyan-400 mb-3">Contact Us</h2>
          <p className="text-slate-300 leading-relaxed">
            If you have questions about this Privacy Policy or our data practices, please contact us at:
          </p>
          <div className="mt-3 p-4 bg-slate-800 border border-slate-700 rounded-lg">
            <p className="text-white">TaskTitan Privacy Team</p>
            <p className="text-slate-400">
              Email:{' '}
              <a href="mailto:privacy@tasktitan.dev" className="text-cyan-400 hover:underline">
                privacy@tasktitan.dev
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
