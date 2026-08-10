import { getImageInstructions } from "./image-instructions";
import { SCREENSHOT_INSTRUCTIONS } from "./screenshot-instructions";
import { STEPS_TO_COMPLETE } from "./steps-to-complete";
import { CODE_SAMPLES, STYLE_GUIDE_BASE, TODO_COMMENTS } from "./style-guide";
import SKILL_BUILDING_STEPS_TO_COMPLETE_SAMPLE from "@/prompts/skill-building-steps-to-complete-sample.md?raw";

export const getSkillBuildingSharedTemplate = (images: string[]) => `
<sample>
${SKILL_BUILDING_STEPS_TO_COMPLETE_SAMPLE}
</sample>

${STYLE_GUIDE_BASE}

${CODE_SAMPLES}

${getImageInstructions(images)}

${SCREENSHOT_INSTRUCTIONS}

<rules>
${STEPS_TO_COMPLETE}

${TODO_COMMENTS}

The code samples include TODO comments, and the steps to complete are really an illustrated version of the TODO comments.

<output>
The text should be in two parts:

1. A brief introduction to the skill building problem
2. A list of steps to complete.

<introduction-format>
<introduction-example>
Our memory setup is working nicely, but it has a big problem - we can only _add_ memories. We can't update or delete them. This means it's only good for truly permanent information, which isn't realistic.

That ends up being quite limiting. Even "permanent" facts about people can change over time. You think you like window seats on planes, but as you get older (and perhaps your bladder gets worse), you might prefer aisle seats.

So our system needs to be able to not only add memories about you but also update its database of information.
</introduction-example>
<introduction-style-guide>
The introduction should be inspired by the transcript.

It should use short paragraphs - no more than 240 characters.

It should be relatively short - only 2-3 paragraphs long.

It should be a maximum of 700 characters long.
</introduction-style-guide>
</introduction-format>
</output>

</rules>
`;
