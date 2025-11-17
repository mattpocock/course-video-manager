const DIAGRAM_TIP_PROMPT = () =>
  `
  Go.

  <rules>

  The purpose of the material is to show a user a cool tip that will help them in the future. They are not solving a problem in an active exercise, they are passively learning a tip.

  Stick closely to the transcript.

  The video the transcript is based on is of an instructor walking through diagrams. You have been provided with the diagrams. Use them as markdown links in the output:

  <example>
  ![Diagram 1](./path/to/diagram.png)
  </example>
  <example>
  ![Diagram 2](./path/to/diagram.png)
  </example>

  </rules>
  `.trim();
