// https://www.rfc-editor.org/rfc/rfc9116
export function securityTxt(): string {
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + 6);
  return `Contact: mailto:april@trails.lat
Expires: ${expires.toISOString()}
Preferred-Languages: en
Canonical: https://trails.lat/.well-known/security.txt
`;
}

export function privacyHtml(): string {
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>Privacy Policy - trails.lat</title>
    <link rel="canonical" href="https://trails.lat/privacy">
    <meta name="viewport" content="initial-scale=1, width=device-width" />
    <link rel="icon" href="/static/favicon.webp" type="image/webp" />
    <style>
      body {
        color: #212121;
        font-family: ui-sans-serif, system-ui, sans-serif;
        line-height: 1.5;
        margin: 0 auto;
        max-width: 48rem;
        padding: 2rem 1rem;
      }

      h2 {
        margin-top: 2rem;
      }

      a {
        color: #1d4ed8;
      }

      table {
        border-collapse: collapse;
        font-size: 0.875rem;
        width: 100%;
      }

      th, td {
        border: 1px solid #d1d5dc;
        padding: 0.25rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #f3f4f6;
      }
    </style>
  </head>
  <body>
<h1>Privacy Policy for trails.lat</h1>
<p>Effective Date: November 9, 2026 | Last Updated: November 9, 2026</p>
<h2>Introduction</h2>
<p>
  This Privacy Policy describes the personal data that <strong>trails.lat</strong>, accessible from
  <a href="https://trails.lat" target="_blank" rel="noopener">https://trails.lat</a> and through
  the trails.lat apps for Android and iOS, collects, why it is collected, how it is used and
  protected, and the rights you have regarding it.
</p>
<p>
  This policy applies to the trails.lat website and apps. Third-party services that trails.lat loads
  map data from are described under Third-Party Services, and their own privacy policies govern
  their handling of your data.
</p>
<p>
  Questions and requests may be sent to <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>.
</p>
<h2>Definitions</h2>
<ul>
  <li>
    <strong>App:</strong>
    The trails.lat app for Android or iOS.
  </li>
  <li>
    <strong>Data Controller:</strong>
    trails.lat, operated by April Schleck in the United States, which determines the purposes and
    means of processing personal data on trails.lat.
  </li>
  <li>
    <strong>Personal Data:</strong>
    Any information relating to an identified or identifiable person, including name, email address,
    IP address, and online identifiers.
  </li>
  <li>
    <strong>Processing:</strong>
    Any operation on personal data, including collection, storage, use, transfer, and deletion.
  </li>
  <li>
    <strong>You / User:</strong>
    Any individual accessing or using trails.lat.
  </li>
</ul>
<h2>Information We Collect</h2>
<p><strong>1. Account Information</strong></p>
<p>
  We store the information your login provider shares with us, as listed under Social Login, and
  when you created your account and last logged in.
</p>
<p><strong>2. Content You Create</strong></p>
<p>We store your collections, what you add to them, and who you share them with.</p>
<p><strong>3. Photos</strong></p>
<p>
  We store the photos you upload and their metadata, including when and where they were taken and
  the camera used to take them. Anyone with access to the collection a photo is in can see it and
  where it was taken.
</p>
<p><strong>4. Recorded Tracks</strong></p>
<p>
  The App collects your device's location only after you start recording a track, and stops when
  you stop recording. While you record, we collect your device's precise location, including while
  the App is in the background, and the time of each recorded point. Anyone with access to the
  collection you save a track to can see it.
</p>
<p><strong>5. Server Logs</strong></p>
<p>
  Our web server records the IP address, time, requested URL, referring URL, and browser user agent
  of each request.
</p>
<h2>How We Use Your Information</h2>
<table>
  <thead>
    <tr>
      <th>Purpose</th>
      <th>Data</th>
      <th>Legal Basis (GDPR)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Logging you in and showing your account</td>
      <td>Account information</td>
      <td>Contract</td>
    </tr>
    <tr>
      <td>Storing, displaying, and sharing your collections, photos, and recorded tracks</td>
      <td>Content you create, photos, recorded tracks</td>
      <td>Contract</td>
    </tr>
    <tr>
      <td>Recording tracks</td>
      <td>Device location, while recording</td>
      <td>Consent, given when you start recording</td>
    </tr>
    <tr>
      <td>Preventing abuse and diagnosing errors</td>
      <td>Server logs</td>
      <td>Legitimate interests</td>
    </tr>
    <tr>
      <td>Responding to legal requests</td>
      <td>Any of the above, as required</td>
      <td>Legal obligation</td>
    </tr>
  </tbody>
</table>
<p>
  We do not use your data for advertising, do not build profiles of users, and do not make automated
  decisions about you.
</p>
<h2>Cookies and Browser Storage</h2>
<p>trails.lat sets the following cookies.</p>
<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Category</th>
      <th>Purpose</th>
      <th>Duration</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>logged_in</code></td>
      <td>Strictly necessary</td>
      <td>Keeps you logged in</td>
      <td>7 days</td>
    </tr>
    <tr>
      <td><code>oidc</code></td>
      <td>Strictly necessary</td>
      <td>Used while you log in</td>
      <td>Deleted when the login completes</td>
    </tr>
    <tr>
      <td><code>sidebar</code></td>
      <td>Preference</td>
      <td>Which sidebar sections you left open</td>
      <td>1 year</td>
    </tr>
    <tr>
      <td><code>time_zone</code></td>
      <td>Preference</td>
      <td>Whether times are shown in your device's time zone or the map's</td>
      <td>1 year</td>
    </tr>
    <tr>
      <td><code>unit_system</code></td>
      <td>Preference</td>
      <td>Whether distances are shown in metric or imperial units</td>
      <td>1 year</td>
    </tr>
  </tbody>
</table>
<p>
  trails.lat also stores some of your preferences in your browser's local storage, and temporary
  login data in its session storage.
</p>
<p>You can delete cookies through your browser settings.</p>
<h2>Social Login and Third-Party Authentication</h2>
<p>You may log in with the following providers. We receive the data listed for each.</p>
<ul>
  <li>
    <strong>Apple:</strong>
    Your Apple account identifier, name, and email address.
  </li>
  <li>
    <strong>Google:</strong>
    Your Google account identifier, name, email address, and profile picture URL.
  </li>
  <li>
    <strong>OpenStreetMap:</strong>
    Your OpenStreetMap account identifier only.
  </li>
</ul>
<p>
  You may revoke trails.lat's access in the provider's account settings at any time. Each provider's
  own privacy policy governs the data it holds about you.
</p>
<h2>User-Uploaded Files and Content</h2>
<p>
  Collections are private by default. You can share a collection with specific people or make it
  public. Everyone with access to a collection can see all of its contents, including photos, their
  metadata, and recorded tracks. People with access to a collection can copy or export its contents,
  and deleting the collection or your account does not delete those copies.
</p>
<p>
  Uploaded photos may be scanned for malware or policy violations by automated tools. Deleting a
  collection deletes its contents and photos. Deleted content remains in backups until those backups
  expire, as described under Data Retention.
</p>
<h2>Third-Party Services and Integrations</h2>
<p>The following services receive data when you use trails.lat:</p>
<ul>
  <li>
    <strong>Cloudflare:</strong>
    All requests to trails.lat pass through Cloudflare, which sees your IP address and the contents
    of each request in order to deliver it to our server and protect it from attacks.
  </li>
  <li>
    <strong>rsync.net:</strong>
    Stores encrypted backups of our database and uploaded photos.
  </li>
  <li>
    <strong>GoatCounter:</strong>
    Counts page views. Your browser sends each page view to GoatCounter, which keeps only aggregate
    counts and does not store your IP address or user agent or set cookies. These counts cannot identify you. See
    <a href="https://www.goatcounter.com/help/gdpr" target="_blank" rel="noopener">
      GoatCounter's GDPR statement
    </a>
    .
  </li>
</ul>
<p>
  To draw the map, your browser requests data directly from the following services. Each request
  reveals your IP address and the area of the map you are viewing, but none of them receive your
  trails.lat account information or collections.
</p>
<ul>
  <li>
    <strong>Protomaps:</strong>
    Basemap tiles
  </li>
  <li>
    <strong>Mapterhorn:</strong>
    Terrain elevation
  </li>
  <li>
    <strong>Microsoft Planetary Computer:</strong>
    Land cover imagery
  </li>
  <li>
    <strong>Element 84 Earth Search:</strong>
    Satellite imagery
  </li>
  <li>
    <strong>Macrostrat:</strong>
    Geologic map tiles, when that layer is enabled
  </li>
  <li>
    <strong>Google Fonts:</strong>
    Fonts for map labels
  </li>
</ul>
<h2>How We Share Your Information</h2>
<p>We do not sell or rent your personal data. We share it only in these circumstances:</p>
<ul>
  <li>
    <strong>With other users, at your direction:</strong>
    When you share a collection, the users you share it with can see its contents and your display
    name.
  </li>
  <li>
    <strong>Service providers:</strong>
    The services listed under Third-Party Services, to the extent needed to operate trails.lat.
  </li>
  <li>
    <strong>Legal requirements:</strong>
    Where required by law, regulation, subpoena, or court order.
  </li>
  <li>
    <strong>Safety:</strong>
    To protect the rights, property, or safety of trails.lat, its users, or the public.
  </li>
  <li>
    <strong>Transfer of the service:</strong>
    If trails.lat is transferred to another operator, your data may transfer with it. We will
    announce such a transfer on the website and by email where we have your address.
  </li>
</ul>
<h2>Data Security</h2>
<ul>
  <li>All connections to trails.lat use HTTPS.</li>
  <li>Backups are encrypted before they leave our server.</li>
</ul>
<p>
  In the event of a personal data breach likely to result in risk to your rights, we will notify
  affected users and the relevant supervisory authorities within the legally required timeframe.
</p>
<h2>Data Retention</h2>
<p>
  We retain personal data only as long as necessary to fulfil stated purposes or as required by law:
</p>
<table>
  <thead>
    <tr>
      <th>Data Type</th>
      <th>Retention Period</th>
      <th>Reason</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Account information</td>
      <td>Until you delete your account</td>
      <td>Service delivery</td>
    </tr>
    <tr>
      <td>Collections, photos, and recorded tracks</td>
      <td>Until you delete them or your account</td>
      <td>Service delivery</td>
    </tr>
    <tr>
      <td>Server logs</td>
      <td>30 days</td>
      <td>Abuse prevention and error diagnosis</td>
    </tr>
    <tr>
      <td>Backups</td>
      <td>Up to 60 days</td>
      <td>Recovery from data loss</td>
    </tr>
    <tr>
      <td>Correspondence sent to privacy@trails.lat</td>
      <td>As long as needed to resolve your request</td>
      <td>Responding to you</td>
    </tr>
  </tbody>
</table>
<p>
  You can delete your account at any time, which deletes your account information, your
  collections, and the photos you uploaded. Data in backups expires within 60 days. Data may be kept longer when legally required.
</p>
<h2>Your Privacy Rights</h2>
<p>
  Depending on your location, you may have the right to access, correct, delete, restrict, or
  transfer your personal data. You can export or delete your collections and delete your account
  yourself from within trails.lat. For any other request, contact
  <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>
  . We will respond within the timeframe required by applicable law. You will not be penalized or
  discriminated against for exercising your privacy rights.
</p>
<h2>GDPR - European Union Data Protection Rights</h2>
<p>
  If you are in the EU or EEA, the General Data Protection Regulation (EU) 2016/679 grants you these
  rights:
</p>
<ul>
  <li>
    <strong>Right of Access (Art. 15):</strong>
    Request a copy of the personal data we hold about you and how it is processed.
  </li>
  <li>
    <strong>Right to Rectification (Art. 16):</strong>
    Request correction of inaccurate or incomplete data.
  </li>
  <li>
    <strong>Right to Erasure (Art. 17):</strong>
    Request deletion of your data, or delete your account yourself, subject to legal retention
    obligations.
  </li>
  <li>
    <strong>Right to Restriction of Processing (Art. 18):</strong>
    Request that we halt processing in certain circumstances.
  </li>
  <li>
    <strong>Right to Data Portability (Art. 20):</strong>
    Receive your data in a structured, machine-readable format and transfer it to another controller
    where technically feasible.
  </li>
  <li>
    <strong>Right to Object (Art. 21):</strong>
    Object to processing based on legitimate interests, which covers server logs.
  </li>
  <li>
    <strong>Rights re: Automated Decisions (Art. 22):</strong>
    Not be subject to solely automated decisions, including profiling, that produce significant
    legal or similarly significant effects, without human review.
  </li>
  <li>
    <strong>Right to Withdraw Consent (Art. 7(3)):</strong>
    Withdraw consent at any time where processing relies on it, without affecting the lawfulness of
    prior processing. You can withdraw consent to location access in your device's settings.
  </li>
</ul>
<p>
  <strong>Legal Bases for Processing:</strong>
  Art. 6(1)(a) Consent, for reading your device's location while recording a track; Art. 6(1)(b)
  Contract, for providing your account and collections; Art. 6(1)(c) Legal obligation;
  Art. 6(1)(f) Legitimate interests, for server logs. We do not process special category data.
</p>
<p>
  <strong>International Transfers:</strong>
  Our servers are located in the European Union and the United States, and Cloudflare and the other
  providers listed above may process requests in other countries. Transfers outside the EEA rely on
  the EU Standard Contractual Clauses (Commission Decision 2021/914) or the EU-U.S. Data Privacy
  Framework, as applicable to each provider.
</p>
<p>
  We will respond to GDPR requests within one month, extendable by two months for complex requests.
  You may also lodge a complaint with the supervisory authority in your EU Member State.
</p>
<h2>UK GDPR - United Kingdom Rights</h2>
<p>
  If you are in the UK, your rights under the UK GDPR and Data Protection Act 2018 mirror those
  under the EU GDPR listed above. The Information Commissioner's Office (ICO) is the UK supervisory
  authority:
  <a href="https://ico.org.uk" target="_blank" rel="noopener">ico.org.uk</a>
  . International transfers from the UK are governed by UK International Data Transfer Agreements
  (IDTAs), the UK Addendum to the EU Standard Contractual Clauses, or the UK Extension to the
  EU-U.S. Data Privacy Framework.
</p>
<h2>CCPA / CPRA - California Consumer Privacy Rights</h2>
<p>
  The California Consumer Privacy Act (CCPA), as amended by the CPRA, grants California residents:
</p>
<ul>
  <li>
    <strong>Right to Know:</strong>
    Disclosure of the categories and specific pieces of personal information collected, their
    sources, the purposes for collecting them, and the third parties they are shared with.
  </li>
  <li>
    <strong>Right to Delete:</strong>
    Deletion of your personal information, subject to legal exceptions.
  </li>
  <li>
    <strong>Right to Correct:</strong>
    Correction of inaccurate personal information.
  </li>
  <li>
    <strong>Right to Opt Out of Sale or Sharing:</strong>
    trails.lat does not sell personal information or share it for cross-context behavioral
    advertising.
  </li>
  <li>
    <strong>Right to Limit Use of Sensitive Personal Information:</strong>
    The only sensitive personal information trails.lat collects is precise location, from photo
    metadata and recorded tracks, which we use only to display photos and tracks on the map.
  </li>
  <li>
    <strong>Right to Non-Discrimination:</strong>
    We will not deny service or provide a lesser service because you exercised a CCPA right.
  </li>
</ul>
<p><strong>Personal information collected in the past 12 months:</strong></p>
<ul>
  <li>
    <strong>Identifiers:</strong>
    Name, email address, login provider account identifier, and IP address, collected from you and
    your login provider
  </li>
  <li>
    <strong>Internet or network activity:</strong>
    Server logs, collected from your browser
  </li>
  <li>
    <strong>Geolocation data:</strong>
    Photo GPS metadata, collected from photos you upload, and recorded tracks, collected from your
    device
  </li>
  <li>
    <strong>Audio, electronic, or visual information:</strong>
    Photos you upload
  </li>
</ul>
<p>
  Submit CCPA requests to
  <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>
  . We will verify your identity by confirming that the request comes from the email address on your
  account, or by asking you to log in, and will respond within 45 days, extendable by 45 days.
  Authorized agents may submit requests on your behalf with proper documentation.
</p>
<p>
  <strong>Other US State Privacy Rights:</strong>
  Residents of Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), Texas (TDPSA), Oregon (OCPA),
  and other states with similar privacy laws may exercise equivalent rights by contacting
  <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>
  .
</p>
<h2>COPPA - Children's Online Privacy Protection</h2>
<p>
  <strong>trails.lat</strong>
  is not directed to children under 13. We do not knowingly collect personal information from
  children under 13, or under 16 in jurisdictions where a higher threshold applies, such as certain
  EU member states under GDPR Art. 8.
</p>
<p>
  If we learn that we have collected personal information from a child under the applicable age
  without verified parental consent, we will delete the child's account and its contents. Parents or
  guardians who believe their child has created an account on trails.lat should contact
  <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>
  .
</p>
<h2>Links to External Websites</h2>
<p>
  trails.lat links to other websites, including OpenStreetMap and the sources of map data. This
  Privacy Policy does not apply to those websites, and their own privacy policies govern your use of
  them.
</p>
<h2>Do Not Track (DNT) Signals</h2>
<p>trails.lat does not change its behavior in response to Do Not Track signals.</p>
<h2>Changes to This Privacy Policy</h2>
<p>
  We may update this Privacy Policy. When we do, we will change the "Last Updated" date at the top
  of this page. For material changes, we will also post a notice on trails.lat.
</p>
<h2>Contact Us</h2>
<ul>
  <li>
    <strong>Email:</strong>
    <a href="mailto:privacy@trails.lat">privacy@trails.lat</a>
  </li>
</ul>
    <script
        async
        data-goatcounter="https://trails-lat.goatcounter.com/count"
        src="//gc.zgo.at/count.js"></script>
  </body>
</html>
`;
}
