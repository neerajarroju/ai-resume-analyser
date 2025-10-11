// Import necessary packages
const express = require('express');
const axios = require('axios');
const path = require('path');
const docx = require('docx');
require('dotenv').config(); // To manage environment variables

// Destructure necessary components from docx
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, HorizontalRule } = docx;

// Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(express.json({ limit: '5mb' })); // Increase payload size limit
app.use(express.static(path.join(__dirname))); // Serve static files like index.html

// --- Helper function for Gemini API call ---
const callGeminiApi = async (prompt, isJson = false) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error('API key not found. Please set it in the .env file.');
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        if (isJson) {
            payload.generationConfig = { responseMimeType: "application/json" };
        }
        const response = await axios.post(apiUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        const generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText) {
            return generatedText;
        } else {
            throw new Error("The API returned an empty or invalid response.");
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get a response from the AI model.');
    }
};


// --- API Endpoint for Resume Generation ---
app.post('/api/generate', async (req, res) => {
    const { studentData, jobDescription } = req.body;
    if (!studentData) {
        return res.status(400).json({ error: 'Student data is required.' });
    }
    const prompt = `
        Act as an expert resume writer. Based on the provided data, create a professional resume.
        Return the entire output as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON.

        The JSON object must have this exact structure:
        {
          "name": "Full Name",
          "title": "Professional Title (e.g., Professional Accountant)",
          "contact": {
            "phone": "Phone Number",
            "email": "Email Address",
            "address": "City, State"
          },
          "summary": "A paragraph for the 'ABOUT ME' section.",
          "sections": [
            {
              "title": "EDUCATION",
              "items": [
                {
                  "heading": "University Name | Dates (e.g., 2026-2030)",
                  "subheading": "Degree, Major",
                  "description": "A single paragraph with details about coursework or achievements."
                }
              ]
            },
            {
              "title": "WORK EXPERIENCE",
              "items": [
                {
                  "heading": "Company | Dates (e.g., 2033 - 2035)",
                  "subheading": "Job Title",
                  "description": "A single paragraph describing responsibilities and accomplishments."
                }
              ]
            },
            {
              "title": "SKILLS",
              "items": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5", "Skill 6"]
            }
          ],
          "atsScore": "An ATS score as a percentage (e.g., '91%')",
          "suggestions": "A string containing 2-3 actionable suggestions for improvement, separated by newlines."
        }
        
        **Student's Raw Information:**
        ---
        ${studentData}
        ---

        **Target Job Description:**
        ---
        ${jobDescription || 'None provided. Generate a strong, general-purpose resume.'}
        ---
    `;
    try {
        const jsonResponse = await callGeminiApi(prompt, true);
        const resumeData = JSON.parse(jsonResponse);

        // --- FIX START: This section is updated to generate structured HTML ---
        let resumeHtmlForWeb = `<h2>${resumeData.name}</h2><p><strong>${resumeData.title}</strong></p>`;
        resumeHtmlForWeb += `<h3>ABOUT ME</h3><p>${resumeData.summary}</p>`;

        resumeData.sections.forEach(section => {
            resumeHtmlForWeb += `<h3>${section.title}</h3>`;
            if (section.title.toUpperCase() === 'SKILLS') {
                resumeHtmlForWeb += `<ul>${section.items.map(item => `<li>${item}</li>`).join('')}</ul>`;
            } else {
                // Use separate <p> tags for better structure
                section.items.forEach(item => {
                    resumeHtmlForWeb += `<p><strong>${item.heading}</strong></p>`;
                    resumeHtmlForWeb += `<p><em>${item.subheading}</em></p>`;
                    resumeHtmlForWeb += `<p>${item.description}</p>`;
                });
            }
        });
        // --- FIX END ---

        res.json({
            resumeText: resumeHtmlForWeb, // This is now structured HTML
            resumeData,
            atsScore: resumeData.atsScore,
            suggestions: resumeData.suggestions
        });

    } catch (error) {
        console.error("Error processing generation request:", error);
        res.status(500).json({ error: "Failed to generate structured resume data. The AI response might be malformed." });
    }
});

// --- API Endpoint to create and download a DOCX file ---
app.post('/api/download-docx', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Structured resume data is required.' });
    }

    try {
        const doc = new Document({
              styles: {
                  paragraphStyles: [
                      {
                          id: "default",
                          name: "Default",
                          basedOn: "Normal",
                          next: "Normal",
                          quickFormat: true,
                          run: { font: "Calibri", size: 22 },
                      },
                       {
                          id: "heading",
                          name: "Heading",
                          basedOn: "Normal",
                          next: "Normal",
                          quickFormat: true,
                          run: { font: "Calibri Light", size: 32, bold: true, allCaps: true },
                          paragraph: { spacing: { before: 200, after: 100 } },
                      },
                  ],
              },
              sections: [{
                  properties: { },
                  children: buildDocxFromJSON(resumeData),
              }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename=resume.docx',
        });
        res.end(buffer);

    } catch (error) {
        console.error("Error creating DOCX:", error);
        res.status(500).json({ error: "Failed to create DOCX file." });
    }
});


// FIX: This function has been completely rewritten for a more elegant and professional design.
function buildDocxFromJSON(data) {
    const FONT_FAMILY = "Calibri";

    const createSectionHeading = (text) => new Paragraph({
        children: [new TextRun({ text, font: FONT_FAMILY, size: 24, bold: true, allCaps: true })],
        spacing: { before: 300, after: 150 },
        border: { bottom: { color: "auto", space: 1, value: "single", size: 6 } },
    });

    return [
        // --- HEADER SECTION ---
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: data.name || "Full Name", font: FONT_FAMILY, size: 56, bold: true })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: data.title || "Professional Title", font: FONT_FAMILY, size: 24, color: "555555" })],
            spacing: { after: 100 },
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({ text: data.contact?.phone || "", font: FONT_FAMILY, size: 22 }),
                new TextRun({ text: " | ", font: FONT_FAMILY, size: 22, color: "AAAAAA" }),
                new TextRun({ text: data.contact?.email || "", font: FONT_FAMILY, size: 22 }),
                new TextRun({ text: " | ", font: FONT_FAMILY, size: 22, color: "AAAAAA" }),
                new TextRun({ text: data.contact?.address || "", font: FONT_FAMILY, size: 22 }),
            ],
            spacing: { after: 300 },
        }),

        // --- ABOUT ME SECTION ---
        createSectionHeading("ABOUT ME"),
        new Paragraph({
            children: [new TextRun({ text: data.summary || "", font: FONT_FAMILY, size: 22 })],
            spacing: { after: 300 },
        }),

        // --- DYNAMIC SECTIONS (EDUCATION, EXPERIENCE, etc.) ---
        ...data.sections.flatMap(section => {
            const sectionChildren = [createSectionHeading(section.title)];

            if (section.title.toUpperCase() === 'SKILLS' && Array.isArray(section.items)) {
                sectionChildren.push(
                    new Paragraph({
                        children: section.items.map((skill, index) => new TextRun({
                            text: `${skill}${index < section.items.length - 1 ? ' • ' : ''}`,
                            font: FONT_FAMILY,
                            size: 22,
                        })),
                    })
                );
            } else {
                (section.items || []).forEach(item => {
                    sectionChildren.push(
                        new Paragraph({
                            children: [new TextRun({ text: item.heading || "", font: FONT_FAMILY, size: 22, bold: true })],
                            spacing: { before: 200 },
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: item.subheading || "", font: FONT_FAMILY, size: 22, italics: true, color: "555555" })],
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: item.description || "", font: FONT_FAMILY, size: 22 })],
                            spacing: { after: 200 },
                        })
                    );
                });
            }
            return sectionChildren;
        })
    ];
}

// --- API Endpoint to Improve a Description ---
app.post('/api/improve', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text to improve is required.' });
    const prompt = `Rewrite the following resume description to be more professional and impactful. Use strong action verbs and focus on achievements. Keep it concise. Original text: "${text}"`;
    try {
        const improvedText = await callGeminiApi(prompt);
        res.json({ improvedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint for Cover Letter Generation ---
// ***** BUG FIX STARTS HERE *****
app.post('/api/generate-cover-letter', async (req, res) => {
    // Destructure resumeData instead of resumeText
    const { studentData, jobDescription, resumeData } = req.body; 
    
    // Validate required data, checking for resumeData
    if (!studentData || !jobDescription || !resumeData) {
        return res.status(400).json({ error: 'Missing required data.' });
    }

    // --- REBUILD PLAIN TEXT RESUME FROM resumeData ---
    // This logic is from the old working code. It ensures a clean, non-HTML resume is sent to the AI.
    let plainResumeText = `${resumeData.name.toUpperCase()}\n${resumeData.title}\n\n`;
    plainResumeText += `ABOUT ME\n${resumeData.summary}\n\n`;
    resumeData.sections.forEach(section => {
        plainResumeText += `${section.title.toUpperCase()}\n`;
        if (section.title.toUpperCase() === 'SKILLS') {
            plainResumeText += `- ${section.items.join('\n- ')}\n`;
        } else {
            (section.items || []).forEach(item => {
                plainResumeText += `${item.heading}\n${item.subheading}\n${item.description}\n`;
            });
        }
        plainResumeText += '\n';
    });
    // --- END OF REBUILD LOGIC ---

    // Use the newly created plainResumeText in the prompt
    const prompt = `Based on the student's info, their resume, and the job description, write a professional cover letter.\n\n**Student Info:**\n${studentData}\n\n**Resume:**\n${plainResumeText}\n\n**Job Description:**\n${jobDescription}`;
    
    try {
        const coverLetterText = await callGeminiApi(prompt);
        res.json({ coverLetterText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ***** BUG FIX ENDS HERE *****


// --- API Endpoint for Interview Prep Generation ---
app.post('/api/generate-interview-prep', async (req, res) => {
    const { studentData, jobDescription } = req.body;
    if (!studentData) return res.status(400).json({ error: 'Student data is required.' });
    const prompt = `Act as a career coach. Based on the student's info and job description, generate 3-4 behavioral interview questions. For each, provide a sample answer using the STAR method based on their experience.\n\n**Student Info:**\n${studentData}\n\n**Job Description:**\n${jobDescription || 'General role in their field.'}`;
    try {
        const interviewPrepText = await callGeminiApi(prompt);
        res.json({ interviewPrepText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ✨ NEW: API Endpoint for Portfolio Website Generation ---
app.post('/api/generate-portfolio', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Resume data is required to generate a portfolio.' });
    }

    const prompt = `
        Act as an expert frontend developer. Based on the provided structured resume data (in JSON format), generate a complete, single-file HTML for a professional and modern personal portfolio website.

        **CRITICAL INSTRUCTIONS:**
        1.  **Single File Only:** The entire output must be a single HTML file. All CSS must be included via CDN.
        2.  **Use Tailwind CSS:** You MUST use Tailwind CSS for all styling. Include it via the CDN in the <head>: <script src="https://cdn.tailwindcss.com"></script>.
        3.  **Responsive Design:** The layout must be fully responsive and look great on mobile, tablet, and desktop screens.
        4.  **Content Population:** Use the provided JSON data to populate all sections of the portfolio.
        5.  **Clean & Modern Aesthetic:** The design should be clean, with good whitespace, professional fonts (like Inter from Google Fonts), and a visually appealing color scheme.
        6.  **Required Sections:** The portfolio MUST include:
            - A hero/header section with the person's name and professional title.
            - An "About Me" section using the summary.
            - A "Projects" section that displays each project in a visually appealing card format.
            - A "Skills" section that lists the skills.
            - A "Contact" section with email, phone, and a link to the contact address.
        7.  **Raw HTML Output:** The final output MUST be only the raw HTML code, starting with <!DOCTYPE html> and ending with </html>. Do not include any explanations, comments, or markdown formatting like \`\`\`html.

        **Resume Data (JSON):**
        ---
        ${JSON.stringify(resumeData, null, 2)}
        ---
    `;

    try {
        const portfolioHtml = await callGeminiApi(prompt);
        res.json({ portfolioHtml });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// --- Serve the Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});