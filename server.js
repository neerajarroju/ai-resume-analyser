// Import necessary packages
const express = require('express');
const axios = require('axios');
const path = require('path');
const docx = require('docx');
require('dotenv').config(); // To manage environment variables

// Destructure necessary components from docx for better styling
const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;

// Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(express.json({ limit: '5mb' })); // Increase payload size limit
app.use(express.static(path.join(__dirname))); // Serve static files like index.html and favicon.png

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
            console.error("API Response was empty:", JSON.stringify(response.data, null, 2));
            throw new Error("The AI model returned an empty or invalid response.");
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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
        Return the entire output as a single, valid JSON object. Do not include any text or markdown formatting (like \`\`\`json) before or after the JSON.

        The JSON object must have this exact structure:
        {
          "name": "Full Name",
          "title": "Professional Title (e.g., Aspiring Software Engineer)",
          "contact": {
            "phone": "Phone Number",
            "email": "Email Address",
            "address": "City, State" 
          },
          "summary": "A concise, professional summary paragraph for the 'ABOUT ME' section.",
          "sections": [
            {
              "title": "EDUCATION",
              "items": [
                {
                  "heading": "University Name | Graduation Date (e.g., May 2025)",
                  "subheading": "Degree, Major",
                  "description": "A single paragraph with details about relevant coursework or academic achievements."
                }
              ]
            },
            {
              "title": "WORK EXPERIENCE",
              "items": [
                {
                  "heading": "Company | Dates (e.g., Jan 2023 - Present)",
                  "subheading": "Job Title",
                  "description": "A single paragraph describing responsibilities and accomplishments using action verbs."
                }
              ]
            },
            {
              "title": "PROJECTS",
              "items": [
                {
                  "heading": "Project Name",
                  "subheading": "Technologies Used",
                  "description": "A single paragraph describing the project's purpose and your role."
                }
              ]
            },
            {
              "title": "SKILLS",
              "items": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5", "Skill 6"]
            }
          ],
          "atsScore": "An estimated ATS score as a percentage (e.g., '91%') based on the match with the job description.",
          "suggestions": "A string containing 2-3 actionable suggestions for improvement, separated by newlines (\\n)."
        }
        
        **Student's Raw Information:**
        ---
        ${studentData}
        ---

        **Target Job Description:**
        ---
        ${jobDescription || 'None provided. Generate a strong, general-purpose resume for a recent graduate in their field.'}
        ---
    `;
    try {
        let jsonResponse = await callGeminiApi(prompt, true);
        // FIX: Clean the response to remove markdown formatting that can cause parsing errors.
        jsonResponse = jsonResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const resumeData = JSON.parse(jsonResponse);

        let resumeHtmlForWeb = `<div class="resume-content"><h2 class="text-center">${resumeData.name}</h2><p class="text-center"><strong>${resumeData.title}</strong></p>`;
        resumeHtmlForWeb += `<h3>ABOUT ME</h3><p>${resumeData.summary}</p>`;

        resumeData.sections.forEach(section => {
            resumeHtmlForWeb += `<h3>${section.title}</h3>`;
            if (section.title.toUpperCase() === 'SKILLS' && Array.isArray(section.items)) {
                resumeHtmlForWeb += `<ul>${section.items.map(item => `<li>${item}</li>`).join('')}</ul>`;
            } else if (Array.isArray(section.items)){
                section.items.forEach(item => {
                    if(item.heading) resumeHtmlForWeb += `<p><strong>${item.heading}</strong></p>`;
                    if (item.subheading) resumeHtmlForWeb += `<p><em>${item.subheading}</em></p>`;
                    if (item.description) resumeHtmlForWeb += `<p>${item.description}</p><br/>`;
                });
            }
        });
        resumeHtmlForWeb += `</div>`;

        res.json({
            resumeText: resumeHtmlForWeb,
            resumeData,
            atsScore: resumeData.atsScore,
            suggestions: resumeData.suggestions
        });

    } catch (error) {
        console.error("Error processing generation request:", error);
        res.status(500).json({ error: "Failed to generate structured resume data. The AI response might be malformed." });
    }
});

// --- Helper function to build a styled DOCX from JSON ---
function buildDocxFromJSON(data) {
    const FONT_FAMILY = "Calibri";

    const createSectionHeading = (text) => new Paragraph({
        children: [new TextRun({ text, font: FONT_FAMILY, size: 24, bold: true, allCaps: true })],
        spacing: { before: 300, after: 150 },
        border: { bottom: { color: "auto", space: 1, value: "single", size: 6 } },
    });

    return [
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
        createSectionHeading("ABOUT ME"),
        new Paragraph({
            children: [new TextRun({ text: data.summary || "", font: FONT_FAMILY, size: 22 })],
            spacing: { after: 300 },
        }),
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
            } else if(Array.isArray(section.items)) {
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

// --- API Endpoint to create and download a DOCX file ---
app.post('/api/download-docx', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Structured resume data is required.' });
    }

    try {
        const doc = new Document({
            sections: [{
                properties: {},
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


// --- API Endpoint to Improve a Description ---
app.post('/api/improve', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text to improve is required.' });
    const prompt = `Rewrite the following resume description to be more professional and impactful. Use strong action verbs and focus on quantifiable achievements. Keep it concise (2-3 bullet points or a short paragraph). Original text: "${text}"`;
    try {
        const improvedText = await callGeminiApi(prompt);
        res.json({ improvedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint for Cover Letter Generation ---
app.post('/api/generate-cover-letter', async (req, res) => {
    const { studentData, jobDescription, resumeData } = req.body; 
    if (!studentData || !jobDescription || !resumeData) {
        return res.status(400).json({ error: 'Missing required data.' });
    }
    let plainResumeText = `${resumeData.name.toUpperCase()}\n${resumeData.title}\n\n`;
    plainResumeText += `ABOUT ME\n${resumeData.summary}\n\n`;
    resumeData.sections.forEach(section => {
        plainResumeText += `${section.title.toUpperCase()}\n`;
        if (section.title.toUpperCase() === 'SKILLS') {
            plainResumeText += `- ${section.items.join('\n- ')}\n`;
        } else if (Array.isArray(section.items)) {
            section.items.forEach(item => {
                if(item.heading) plainResumeText += `${item.heading}\n`;
                if(item.subheading) plainResumeText += `${item.subheading}\n`;
                if(item.description) plainResumeText += `${item.description}\n`;
            });
        }
        plainResumeText += '\n';
    });
    const prompt = `Based on the student's raw info, their final resume, and the target job description, write a professional and compelling cover letter. Address it to the "Hiring Manager". The letter should be enthusiastic, connect the student's skills and experiences directly to the job requirements, and end with a clear call to action. Return only the text of the cover letter. \n\n**Student Info:**\n${studentData}\n\n**Final Resume:**\n${plainResumeText}\n\n**Job Description:**\n${jobDescription}`;
    
    try {
        const coverLetterText = await callGeminiApi(prompt);
        res.json({ coverLetterText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint for Interview Prep Generation ---
app.post('/api/generate-interview-prep', async (req, res) => {
    const { studentData, jobDescription } = req.body;
    if (!studentData) return res.status(400).json({ error: 'Student data is required.' });
    const prompt = `Act as a career coach. Based on the student's info and the provided job description, generate a list of 3-4 likely behavioral interview questions. For each question, provide a detailed sample answer using the STAR (Situation, Task, Action, Result) method, tailored specifically to the student's experience from their info. Format the output clearly with each question followed by its STAR answer.\n\n**Student Info:**\n${studentData}\n\n**Job Description:**\n${jobDescription || 'General role in their field.'}`;
    try {
        const interviewPrepText = await callGeminiApi(prompt);
        res.json({ interviewPrepText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint to Download Cover Letter as DOCX ---
app.post('/api/download-cover-letter-docx', async (req, res) => {
    const { coverLetterText } = req.body;
    if (!coverLetterText) {
        return res.status(400).json({ error: 'Cover letter text is required.' });
    }

    try {
        const doc = new Document({
            sections: [{
                properties: {},
                children: coverLetterText.split('\n').map(text => 
                    new Paragraph({
                        children: [new TextRun(text)],
                    })
                ),
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename=cover-letter.docx',
        });
        res.end(buffer);
    } catch (error) {
        console.error("Error creating Cover Letter DOCX:", error);
        res.status(500).json({ error: "Failed to create DOCX file." });
    }
});


// --- API Endpoint for Portfolio Website Generation ---
app.post('/api/generate-portfolio', async (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) {
        return res.status(400).json({ error: 'Resume data is required to generate a portfolio.' });
    }

    const projectsSection = resumeData.sections.find(s => s.title.toUpperCase() === 'PROJECTS');
    const skillsSection = resumeData.sections.find(s => s.title.toUpperCase() === 'SKILLS');

    const projectCardsHtml = projectsSection && projectsSection.items ? projectsSection.items.map(p => `
        <div class="project-card">
            <div class="project-image-placeholder">
                <h3>${p.heading}</h3>
            </div>
            <div class="project-content">
                <p class="project-tech">${p.subheading || 'Technologies not listed'}</p>
                <p>${p.description}</p>
            </div>
        </div>
    `).join('') : '<p>No projects listed.</p>';

    const skillsHtml = skillsSection && skillsSection.items ? skillsSection.items.map(s => `
        <div class="skill-item">${s}</div>
    `).join('') : '<p>No skills listed.</p>';

    const portfolioHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${resumeData.name} - Portfolio</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { font-family: 'Poppins', sans-serif; line-height: 1.6; color: #333; background-color: #f8f9fa; }
        a { text-decoration: none; color: inherit; }
        .container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
        header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; padding: 5rem 1rem 3rem; }
        header h1 { font-size: 3.5rem; margin-bottom: 0.5rem; font-weight: 700; }
        header p { font-size: 1.3rem; opacity: 0.9; font-weight: 300; }
        nav { background: rgba(0,0,0,0.7); backdrop-filter: blur(10px); padding: 1rem; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        nav ul { display: flex; justify-content: center; flex-wrap: wrap; list-style: none; }
        nav li { margin: 0 1.5rem; }
        nav a { color: white; font-weight: 600; transition: color 0.3s; padding-bottom: 5px; border-bottom: 2px solid transparent; }
        nav a:hover { color: #82a3ff; border-bottom-color: #82a3ff; }
        section { padding: 5rem 1rem; }
        h2 { text-align: center; font-size: 2.5rem; margin-bottom: 3rem; color: #333; position: relative; }
        h2::after { content: ''; display: block; width: 60px; height: 4px; background: #667eea; margin: 10px auto 0; border-radius: 2px;}
        #about { background: white; text-align: center; }
        #about p { max-width: 800px; margin: 0 auto; font-size: 1.1rem; color: #555; }
        #skills { background: #f8f9fa; }
        .skills-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; }
        .skill-item { background: white; color: #667eea; padding: 0.75rem 1.5rem; border-radius: 50px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); font-weight: 600; transition: all 0.3s ease; }
        .skill-item:hover { transform: translateY(-3px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        #projects { background: white; }
        .projects-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; }
        .project-card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08); transition: transform 0.3s, box-shadow 0.3s; }
        .project-card:hover { transform: translateY(-8px); box-shadow: 0 8px 25px rgba(0,0,0,0.12); }
        .project-image-placeholder { background: linear-gradient(135deg, #764ba2 0%, #667eea 100%); color: white; height: 200px; display: flex; align-items: center; justify-content: center; }
        .project-image-placeholder h3 { font-size: 1.5rem; text-align: center; padding: 1rem;}
        .project-content { padding: 1.5rem; }
        .project-tech { font-weight: 600; color: #667eea; margin-bottom: 0.5rem; }
        #contact { background: #f8f9fa; text-align: center; }
        #contact p { font-size: 1.2rem; }
        #contact a { color: #667eea; font-weight: 600; }
        footer { background: #222; color: white; text-align: center; padding: 2rem; }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <h1>${resumeData.name}</h1>
            <p>${resumeData.title}</p>
        </div>
    </header>
    <nav>
        <ul>
            <li><a href="#about">About</a></li>
            <li><a href="#skills">Skills</a></li>
            <li><a href="#projects">Projects</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <section id="about">
        <div class="container">
            <h2>About Me</h2>
            <p>${resumeData.summary}</p>
        </div>
    </section>
    <section id="skills">
        <div class="container">
            <h2>Skills</h2>
            <div class="skills-grid">${skillsHtml}</div>
        </div>
    </section>
    <section id="projects">
        <div class="container">
            <h2>Projects</h2>
            <div class="projects-grid">${projectCardsHtml}</div>
        </div>
    </section>
    <section id="contact">
        <div class="container">
            <h2>Get In Touch</h2>
            <p>Let's connect! Email: <a href="mailto:${resumeData.contact.email}">${resumeData.contact.email}</a> | Phone: ${resumeData.contact.phone}</p>
        </div>
    </section>
    <footer>
        <p>&copy; ${new Date().getFullYear()} ${resumeData.name}. All rights reserved.</p>
    </footer>
</body>
</html>`;

    res.json({ portfolioHtml });
});


// --- Serve the Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

